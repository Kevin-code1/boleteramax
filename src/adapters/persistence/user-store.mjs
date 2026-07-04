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
    emailVerifiedAt: row.email_verified_at || null,
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
            RETURNING id, email, password_hash, display_name, status, email_verified_at
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
          SELECT id, email, password_hash, display_name, status, email_verified_at
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
          SELECT u.id, u.email, u.password_hash, u.display_name, u.status, u.email_verified_at
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

    // ── Verificación de correo ──
    async invalidatePendingVerificationTokens(userId) {
      await query(
        `
          UPDATE email_verification_tokens
          SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL
        `,
        [userId],
      );
    },

    async saveVerificationToken({ userId, tokenHash, expiresAt }) {
      await query(
        `
          INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
          VALUES ($1, $2, $3::timestamptz)
        `,
        [userId, tokenHash, expiresAt],
      );
    },

    // Consumo atómico: solo un intento válido gana; los siguientes ven used_at.
    async consumeVerificationToken(tokenHash) {
      const result = await query(
        `
          UPDATE email_verification_tokens
          SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id
        `,
        [tokenHash],
      );
      return result.rows[0]?.user_id || null;
    },

    // Solo para categorizar el fallo (inválido/expirado/usado) tras un consumo
    // fallido; la decisión de seguridad ya la tomó consumeVerificationToken.
    async findVerificationToken(tokenHash) {
      const result = await query(
        'SELECT expires_at, used_at FROM email_verification_tokens WHERE token_hash = $1 LIMIT 1',
        [tokenHash],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { expiresAt: row.expires_at, usedAt: row.used_at || null };
    },

    async markUserVerified(userId) {
      await query(
        `
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
          WHERE id = $1
        `,
        [userId],
      );
    },
  };
}

// Modo dev sin base de datos: usuarios en data/users.json, y sesiones y tokens
// de verificación en memoria (se pierden al reiniciar). El modo por defecto
// usa PostgreSQL.
function createJsonUserStore() {
  const sessions = new Map(); // tokenHash → { userId, expiresAt }
  const verificationTokens = new Map(); // tokenHash → { userId, expiresAt, usedAt }

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
        emailVerifiedAt: null,
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

    async invalidatePendingVerificationTokens(userId) {
      for (const [hash, token] of verificationTokens) {
        if (token.userId === userId && !token.usedAt) {
          verificationTokens.set(hash, { ...token, usedAt: new Date().toISOString() });
        }
      }
    },

    async saveVerificationToken({ userId, tokenHash, expiresAt }) {
      verificationTokens.set(tokenHash, { userId, expiresAt, usedAt: null });
    },

    async consumeVerificationToken(tokenHash) {
      const token = verificationTokens.get(tokenHash);
      if (!token || token.usedAt || Date.parse(token.expiresAt) <= Date.now()) {
        return null;
      }
      verificationTokens.set(tokenHash, { ...token, usedAt: new Date().toISOString() });
      return token.userId;
    },

    async findVerificationToken(tokenHash) {
      const token = verificationTokens.get(tokenHash);
      if (!token) return null;
      return { expiresAt: token.expiresAt, usedAt: token.usedAt };
    },

    async markUserVerified(userId) {
      const users = readUsers();
      const index = users.findIndex(user => user.id === userId);
      if (index === -1) return;
      if (!users[index].emailVerifiedAt) {
        users[index] = { ...users[index], emailVerifiedAt: new Date().toISOString() };
        writeUsers(users);
      }
    },
  };
}

export async function createUserStore() {
  return DATABASE_URL_CONFIGURED ? createPostgresUserStore() : createJsonUserStore();
}
