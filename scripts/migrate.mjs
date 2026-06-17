import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { closePool, query, withTransaction } from '../db/pool.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

async function ensureMigrationsTable() {
  await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filename text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(result.rows.map(row => row.filename));
}

async function getMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => entry.name)
    .sort();
}

async function applyMigration(filename) {
  const fullPath = path.join(migrationsDir, filename);
  const sql = await fs.readFile(fullPath, 'utf8');

  await withTransaction(async client => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  });
}

async function run() {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = await getMigrationFiles();
  const pending = files.filter(filename => !applied.has(filename));

  if (!pending.length) {
    console.log('Database migrations are already up to date.');
    return;
  }

  for (const filename of pending) {
    await applyMigration(filename);
    console.log(`Applied migration: ${filename}`);
  }

  console.log(`Applied ${pending.length} migration(s).`);
}

try {
  await run();
} catch (error) {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
