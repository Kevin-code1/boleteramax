import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { DATABASE_URL_CONFIGURED, ROOT_DIR } from '../../config/index.mjs';

const USERS_JSON_PATH = path.join(ROOT_DIR, 'data', 'users.json');

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    status: row.status,
  };
}

async function createPostgresUserStore() {
  const { query } = await import('../../../db/pool.mjs');

  return {
    async createUser({ email, passwordHash, displayName }) {
      try {
        const result = await query(
          `
            INSERT INTO users (email, password_hash, display_name)
            VALUES ($1, $2, $3)
            RETURNING id, email, password_hash, display_name, status
          `,
          [email, passwordHash, displayName],
        );
        return mapUserRow(result.rows[0]);
      } catch (error) {
        if (error?.code === '23505') return null; // email duplicado
        throw error;
      }
    },

    async findUserByEmail(email) {
      const result = await query(
        `
          SELECT id, email, password_hash, display_name, status
          FROM users
          WHERE email_normalized = lower($1)
          LIMIT 1
        `,
        [email],
      );
      return mapUserRow(result.rows[0]);
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      await query(
        `
          INSERT INTO user_sessions (user_id, session_token_hash, expires_at)
          VALUES ($1, $2, $3::timestamptz)
        `,
        [userId, tokenHash, expiresAt],
      );
    },

    async findSessionUser(tokenHash) {
      const result = await query(
        `
          SELECT u.id, u.email, u.password_hash, u.display_name, u.status
          FROM user_sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.session_token_hash = $1
            AND s.expires_at > now()
            AND u.status = 'active'
          LIMIT 1
        `,
        [tokenHash],
      );
      const user = mapUserRow(result.rows[0]);
      if (user) {
        await query(
          'UPDATE user_sessions SET last_seen_at = now() WHERE session_token_hash = $1',
          [tokenHash],
        );
      }
      return user;
    },

    async deleteSession(tokenHash) {
      await query('DELETE FROM user_sessions WHERE session_token_hash = $1', [tokenHash]);
    },
  };
}

// Modo dev sin base de datos: usuarios en data/users.json y sesiones en
// memoria (se pierden al reiniciar). El modo por defecto usa PostgreSQL.
function createJsonUserStore() {
  const sessions = new Map(); // tokenHash → { userId, expiresAt }

  function readUsers() {
    if (!fs.existsSync(USERS_JSON_PATH)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeUsers(users) {
    fs.writeFileSync(USERS_JSON_PATH, JSON.stringify(users, null, 2));
  }

  return {
    async createUser({ email, passwordHash, displayName }) {
      const users = readUsers();
      const normalized = String(email).toLowerCase();
      if (users.some(user => String(user.email).toLowerCase() === normalized)) {
        return null;
      }

      const user = {
        id: randomUUID(),
        email,
        passwordHash,
        displayName,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      writeUsers(users);
      return user;
    },

    async findUserByEmail(email) {
      const normalized = String(email).toLowerCase();
      return readUsers().find(user => String(user.email).toLowerCase() === normalized) || null;
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      sessions.set(tokenHash, { userId, expiresAt });
    },

    async findSessionUser(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      if (Date.parse(session.expiresAt) <= Date.now()) {
        sessions.delete(tokenHash);
        return null;
      }
      const user = readUsers().find(item => item.id === session.userId) || null;
      return user && user.status === 'active' ? user : null;
    },

    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
}

export async function createUserStore() {
  return DATABASE_URL_CONFIGURED ? createPostgresUserStore() : createJsonUserStore();
}
