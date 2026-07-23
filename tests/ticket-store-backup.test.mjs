import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { readJsonArraySync, writeJsonFileAtomic } from '../src/adapters/persistence/atomic-json.mjs';
import { persistTicketPurchaseByWriteMode } from '../db/tickets.write-mode.mjs';

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boletamax-backup-'));
const storePath = path.join(scratchDir, 'tickets.json');

process.env.TICKETS_STORAGE = 'json';
process.env.TICKETS_WRITE_MODE = 'json';
process.env.TICKETS_PATH = storePath;

const { buildCheckoutQuote } = await import('../src/domain/pricing.mjs');
const { createCheckout } = await import('../src/application/checkout.mjs');
const { createTicketStore } = await import('../src/adapters/persistence/ticket-store.mjs');

const silentLogger = { warn() {}, error() {}, log() {} };

function tempFilesIn(dir) {
  return fs.readdirSync(dir).filter(name => name.includes('.tmp'));
}

function makeTicket(overrides = {}) {
  return {
    ticketId: 'BM-TKT-BACKUP-0001',
    orderId: 'BM-ORD-BACKUP',
    token: 'backup-private-token',
    eventId: 'backup-event',
    eventName: 'Backup Event',
    status: 'active',
    validationCount: 0,
    usedAt: null,
    cancelledAt: null,
    qrPayload: 'http://localhost:3000/tickets/BM-TKT-BACKUP-0001',
    ...overrides,
  };
}

test('writeJsonFileAtomic replaces the destination and leaves no temp files', async () => {
  const target = path.join(scratchDir, 'atomic-ok.json');
  const value = [{ ticketId: 'A' }, { ticketId: 'B' }];

  await writeJsonFileAtomic(target, value);

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), value);
  assert.deepEqual(tempFilesIn(scratchDir), []);
});

test('writeJsonFileAtomic keeps the original file intact when rename fails', async () => {
  const target = path.join(scratchDir, 'atomic-rename-fail.json');
  const original = [{ ticketId: 'KEEP' }];
  fs.writeFileSync(target, JSON.stringify(original));

  const failingFs = {
    writeFile: fsp.writeFile,
    rename: async () => {
      throw new Error('rename boom');
    },
    rm: fsp.rm,
  };

  await assert.rejects(
    () => writeJsonFileAtomic(target, [{ ticketId: 'NEW' }], { fsImpl: failingFs }),
    /rename boom/,
  );

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), original);
  assert.deepEqual(tempFilesIn(scratchDir), []);
});

test('readJsonArraySync returns empty for a missing file without creating it', () => {
  const missing = path.join(scratchDir, 'missing.json');

  assert.deepEqual(readJsonArraySync(missing), []);
  assert.equal(fs.existsSync(missing), false);
});

test('readJsonArraySync throws on corrupt JSON and does not overwrite it', () => {
  const corrupt = path.join(scratchDir, 'corrupt.json');
  fs.writeFileSync(corrupt, '{ this is not valid json');

  assert.throws(() => readJsonArraySync(corrupt));
  assert.equal(fs.readFileSync(corrupt, 'utf8'), '{ this is not valid json');
});

test('readJsonArraySync throws a TypeError when JSON is valid but not an array', () => {
  const notArray = path.join(scratchDir, 'not-array.json');
  fs.writeFileSync(notArray, JSON.stringify({ ticketId: 'A' }));

  assert.throws(() => readJsonArraySync(notArray), TypeError);
});

test('concurrent purchase append and validation do not lose data', async () => {
  const store = createTicketStore({ logger: silentLogger });
  const seeded = makeTicket({ ticketId: 'BM-TKT-SEEDED', status: 'active' });
  const appended = makeTicket({ ticketId: 'BM-TKT-APPENDED' });
  fs.writeFileSync(storePath, JSON.stringify([seeded], null, 2));

  await Promise.all([
    store.withWriteLock(() => store.saveNewTickets({ newTickets: [appended], order: null })),
    store.markTicketUsed({
      ticket: seeded,
      ticketId: seeded.ticketId,
      usedAt: '2026-07-22T10:00:00.000Z',
    }),
  ]);

  const finalTickets = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const byId = new Map(finalTickets.map(ticket => [ticket.ticketId, ticket]));

  assert.equal(finalTickets.length, 2);
  assert.ok(byId.has('BM-TKT-APPENDED'));
  assert.equal(byId.get('BM-TKT-SEEDED').status, 'used');
  assert.equal(byId.get('BM-TKT-SEEDED').validationCount, 1);
  assert.deepEqual(tempFilesIn(scratchDir), []);
});

test('postgres-primary keeps a corrupt backup intact and confirms the purchase', async () => {
  const corruptPath = path.join(scratchDir, 'corrupt-backup.json');
  const corruptContents = `{ corrupted backup ${scratchDir}`;
  fs.writeFileSync(corruptPath, corruptContents);

  const newTickets = [makeTicket({ ticketId: 'BM-TKT-CORRUPT-0001' })];
  const warnings = [];

  const result = await persistTicketPurchaseByWriteMode({
    ticketRecords: newTickets,
    order: null,
    mode: 'postgres-primary',
    saveJsonBackup: async () => {
      const existing = readJsonArraySync(corruptPath);
      await writeJsonFileAtomic(corruptPath, [...existing, ...newTickets]);
    },
    repository: {
      insertPurchaseOrder: async () => ({ attempted: 1, inserted: 1, skipped: 0 }),
    },
    logger: {
      warn: (message, payload) => warnings.push({ message, payload }),
    },
  });

  assert.equal(result.failed, false);
  assert.equal(result.inserted, 1);
  assert.equal(result.jsonBackupFailed, true);
  assert.equal(warnings.length, 1);
  assert.equal(fs.readFileSync(corruptPath, 'utf8'), corruptContents);
  assert.deepEqual(tempFilesIn(scratchDir), []);
});

test('purchased ticket records keep qrPayload but never persist qrDataUrl', async () => {
  const catalogEvent = {
    name: 'Evento Backup',
    date: '1 Enero 2030',
    startsAt: '2030-01-01T20:00:00-06:00',
    venue: 'Palenque Pruebas, Culiacán',
    price: 480,
    available: true,
    venueType: 'palenque',
  };

  const saved = [];
  const checkout = createCheckout({
    catalog: { findCatalogEvent: () => catalogEvent },
    ticketStore: {
      withWriteLock: task => task(),
      getSoldSeatKeys: async () => new Set(),
      saveNewTickets: async ({ newTickets }) => {
        saved.push(...newTickets);
      },
      syncDualWrite: async () => {},
      serializePublic: ticket => ticket,
    },
    captcha: { verifyToken: async () => ({ ok: true, mode: 'demo' }) },
  });

  const event = {
    name: catalogEvent.name,
    date: catalogEvent.date,
    venue: catalogEvent.venue,
  };
  const seats = [{ zone: 'GENERAL', fila: 'A', asiento: 1, tableSize: 1 }];
  const quote = buildCheckoutQuote({ event, seats, catalogEvent });

  const result = await checkout.purchase(
    {
      event,
      seats,
      paymentMethod: 'tarjeta',
      quote,
      buyer: { name: 'Comprador Backup', email: 'backup@boletamax.test' },
    },
    { publicBaseUrl: 'http://localhost:3000', requestContext: {}, user: null },
  );

  assert.equal(result.outcome, 'created');
  assert.equal(saved.length, 1);
  assert.equal(typeof saved[0].qrPayload, 'string');
  assert.ok(saved[0].qrPayload.length > 0);
  assert.equal(Object.hasOwn(saved[0], 'qrDataUrl'), false);
});

test.after(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true });
});
