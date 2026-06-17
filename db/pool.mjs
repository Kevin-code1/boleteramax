import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

let pool = null;

function getDatabaseUrl() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to use PostgreSQL.');
  }
  return databaseUrl;
}

function getSslConfig() {
  const sslMode = String(process.env.PGSSLMODE || process.env.DATABASE_SSL || '').trim().toLowerCase();

  if (!sslMode || sslMode === 'disable' || sslMode === 'false' || sslMode === '0') {
    return undefined;
  }

  if (sslMode === 'verify-full') {
    return true;
  }

  return { rejectUnauthorized: false };
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: getSslConfig(),
    });
  }

  return pool;
}

export function isDatabaseConfigured() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function withTransaction(task) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
