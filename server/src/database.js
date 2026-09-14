import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';

let dbInstance = null;
let currentDbPath = '';
let tursoClient = null;
let currentTursoUrl = '';
let currentTursoToken = '';
let syncTimer = null;

export function getTursoConfig() {
  const url = (process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || process.env.DATABASE_URL || currentTursoUrl || '').trim();
  const token = (process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || currentTursoToken || '').trim();
  return { url, token };
}

export function getTursoStatus() {
  const { url } = getTursoConfig();
  return {
    configured: Boolean(tursoClient),
    connected: Boolean(tursoClient),
    url: url ? url.replace(/:[^@]+@/, ':***@') : null,
  };
}

export async function connectTurso(url, token) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'Turso database URL is required.' };
  }
  try {
    currentTursoUrl = url.trim();
    currentTursoToken = (token || '').trim();
    tursoClient = createClient({
      url: currentTursoUrl,
      authToken: currentTursoToken || undefined,
    });
    await initTursoTables();
    await syncFromTurso();
    return { ok: true, message: 'Connected to Turso DB successfully!' };
  } catch (err) {
    console.error('[Indchat] Failed to connect to Turso DB:', err);
    return { ok: false, error: err.message || 'Failed to connect to Turso DB.' };
  }
}

export async function initTursoTables() {
  if (!tursoClient) return;
  try {
    await tursoClient.batch([
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        public_key TEXT NOT NULL,
        key_backup TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        read_at INTEGER
      );`,
      `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`,
      `CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);`,
      `CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);`,
      `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);`,
    ]);
    console.log('[Indchat] Turso DB tables verified and active.');
  } catch (err) {
    console.error('[Indchat] Turso table init warning:', err.message);
  }
}

export async function syncFromTurso() {
  if (!tursoClient || !dbInstance) return;
  try {
    const result = await tursoClient.execute('SELECT * FROM users');
    const localDb = getDb();
    const insertStmt = localDb.prepare(`
      INSERT OR REPLACE INTO users (id, username, display_name, password_hash, public_key, key_backup, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of result.rows) {
      try {
        insertStmt.run(
          String(row.id),
          String(row.username),
          String(row.display_name),
          String(row.password_hash),
          String(row.public_key),
          row.key_backup ? String(row.key_backup) : null,
          Number(row.created_at) || Date.now(),
          Number(row.updated_at) || Date.now()
        );
      } catch (e) {
        // ignore duplicate
      }
    }
  } catch (err) {
    // Network or sync error - ignore for resilience
  }
}

export function getDatabasePath() {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }
  const defaultDir = path.resolve(process.cwd(), 'server', 'data');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return path.join(defaultDir, 'chat.sqlite');
}

export function initDatabase(dbPath = getDatabasePath()) {
  if (dbInstance && currentDbPath === dbPath) {
    return dbInstance;
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  currentDbPath = dbPath;
  const db = new DatabaseSync(dbPath);
  dbInstance = db;

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      public_key TEXT NOT NULL,
      key_backup TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER,
      read_at INTEGER,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(recipient_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  `);

  // Initialize Turso client if configured via environment variables
  const { url: tursoUrl, token: tursoToken } = getTursoConfig();
  if (tursoUrl && !tursoClient) {
    try {
      tursoClient = createClient({
        url: tursoUrl,
        authToken: tursoToken || undefined,
      });
      console.log('[Indchat] Initialized Turso DB connection.');
      initTursoTables().then(() => syncFromTurso());

      if (!syncTimer) {
        syncTimer = setInterval(syncFromTurso, 20000);
        if (syncTimer.unref) syncTimer.unref();
      }
    } catch (e) {
      console.error('[Indchat] Turso DB startup connection error:', e.message);
    }
  }

  return db;
}

export function getDb() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

// User methods
export function createUser({ id, username, displayName, passwordHash, publicKey, keyBackup }) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, public_key, key_backup, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, username, displayName, passwordHash, publicKey, keyBackup || null, now, now);

  // Store in Turso DB if active
  if (tursoClient) {
    tursoClient.execute({
      sql: `INSERT OR REPLACE INTO users (id, username, display_name, password_hash, public_key, key_backup, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, username, displayName, passwordHash, publicKey, keyBackup || null, now, now],
    }).catch(err => console.error('[Turso DB] User persist error:', err.message));
  }

  return findUserById(id);
}

export function findUserById(id) {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  return stmt.get(id) || null;
}

export function findUserByUsername(username) {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`);
  return stmt.get(username) || null;
}

export function findUserByUsernameOrId(identifier) {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM users WHERE id = ? OR username = ? COLLATE NOCASE`);
  return stmt.get(identifier, identifier) || null;
}

export function searchUsers(query, excludeUserId, limit = 20) {
  const db = getDb();
  const pattern = `%${query.toLowerCase()}%`;
  const stmt = db.prepare(`
    SELECT id, username, display_name AS displayName, public_key AS publicKey
    FROM users
    WHERE id != ? AND (username LIKE ? OR display_name LIKE ?)
    ORDER BY username ASC
    LIMIT ?
  `);
  return stmt.all(excludeUserId, pattern, pattern, limit);
}

export function updateUserKey(userId, publicKey, keyBackup) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE users
    SET public_key = ?, key_backup = COALESCE(?, key_backup), updated_at = ?
    WHERE id = ?
  `);
  stmt.run(publicKey, keyBackup || null, now, userId);
  return findUserById(userId);
}

export function updateKeyBackup(userId, keyBackup) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE users
    SET key_backup = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(keyBackup, now, userId);
  return findUserById(userId);
}

// Session methods
export function createSession(userId, token, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + expiresInMs;
  const stmt = db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(token, userId, now, expiresAt);

  if (tursoClient) {
    tursoClient.execute({
      sql: `INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      args: [token, userId, now, expiresAt],
    }).catch(err => console.error('[Turso DB] Session save error:', err.message));
  }

  return { token, userId, createdAt: now, expiresAt };
}

export function findSession(token) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT s.token, s.user_id AS userId, s.expires_at AS expiresAt,
           u.id, u.username, u.display_name AS displayName, u.public_key AS publicKey, u.key_backup AS keyBackup
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `);
  return stmt.get(token, now) || null;
}

export function deleteSession(token) {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);
  const result = stmt.run(token);

  if (tursoClient) {
    tursoClient.execute({
      sql: `DELETE FROM sessions WHERE token = ?`,
      args: [token],
    }).catch(err => console.error('[Turso DB] Session delete error:', err.message));
  }

  return result;
}

// Message methods
export function saveMessage({ id, senderId, recipientId, ciphertext, encryptedKey, iv, authTag }) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, ciphertext, encrypted_key, iv, auth_tag, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, senderId, recipientId, ciphertext, encryptedKey, iv, authTag, now);

  if (tursoClient) {
    tursoClient.execute({
      sql: `INSERT OR REPLACE INTO messages (id, sender_id, recipient_id, ciphertext, encrypted_key, iv, auth_tag, created_at, delivered_at, read_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, senderId, recipientId, ciphertext, encryptedKey, iv, authTag, now, null, null],
    }).catch(err => console.error('[Turso DB] Message save error:', err.message));
  }

  return getMessageById(id);
}

export function getMessageById(id) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, sender_id AS senderId, recipient_id AS recipientId,
           ciphertext, encrypted_key AS encryptedKey, iv, auth_tag AS authTag,
           created_at AS createdAt, delivered_at AS deliveredAt, read_at AS readAt
    FROM messages
    WHERE id = ?
  `);
  const row = stmt.get(id);
  if (!row) return null;
  return {
    ...row,
    status: row.readAt ? 'read' : row.deliveredAt ? 'delivered' : 'sent',
  };
}

export function getConversation(userId, peerId, limit = 100) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, sender_id AS senderId, recipient_id AS recipientId,
           ciphertext, encrypted_key AS encryptedKey, iv, auth_tag AS authTag,
           created_at AS createdAt, delivered_at AS deliveredAt, read_at AS readAt
    FROM messages
    WHERE (sender_id = ? AND recipient_id = ?)
       OR (sender_id = ? AND recipient_id = ?)
    ORDER BY created_at ASC
    LIMIT ?
  `);
  const rows = stmt.all(userId, peerId, peerId, userId, limit);
  return rows.map((r) => ({
    ...r,
    status: r.readAt ? 'read' : r.deliveredAt ? 'delivered' : 'sent',
  }));
}

export function getRecentConversations(userId) {
  const db = getDb();
  // Group by peer
  const stmt = db.prepare(`
    SELECT m.id, m.sender_id AS senderId, m.recipient_id AS recipientId,
           m.ciphertext, m.created_at AS createdAt, m.delivered_at AS deliveredAt, m.read_at AS readAt,
           CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END AS peerId
    FROM messages m
    WHERE m.id IN (
      SELECT m2.id
      FROM messages m2
      WHERE m2.sender_id = ? OR m2.recipient_id = ?
      ORDER BY m2.created_at DESC
    )
    ORDER BY m.created_at DESC
  `);
  const allRows = stmt.all(userId, userId, userId);
  const seenPeers = new Set();
  const recent = [];

  for (const row of allRows) {
    if (!seenPeers.has(row.peerId)) {
      seenPeers.add(row.peerId);
      const peerUser = findUserById(row.peerId);
      if (peerUser) {
        // Count unread messages from this peer
        const unreadStmt = db.prepare(`
          SELECT COUNT(*) AS count
          FROM messages
          WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
        `);
        const unreadCount = unreadStmt.get(row.peerId, userId)?.count || 0;

        recent.push({
          peer: {
            id: peerUser.id,
            username: peerUser.username,
            displayName: peerUser.display_name,
            publicKey: peerUser.public_key,
          },
          lastMessage: {
            id: row.id,
            senderId: row.senderId,
            createdAt: row.createdAt,
            status: row.readAt ? 'read' : row.deliveredAt ? 'delivered' : 'sent',
          },
          unreadCount,
        });
      }
    }
  }

  return recent;
}

export function markMessagesDelivered(recipientId, messageIds) {
  const db = getDb();
  const now = Date.now();
  let updatedCount = 0;
  const stmt = db.prepare(`
    UPDATE messages
    SET delivered_at = ?
    WHERE id = ? AND recipient_id = ? AND delivered_at IS NULL
  `);
  for (const id of messageIds) {
    const result = stmt.run(now, id, recipientId);
    if (result.changes > 0) {
      updatedCount += result.changes;
    }
  }

  if (tursoClient && messageIds.length > 0) {
    for (const id of messageIds) {
      tursoClient.execute({
        sql: `UPDATE messages SET delivered_at = ? WHERE id = ? AND recipient_id = ? AND delivered_at IS NULL`,
        args: [now, id, recipientId],
      }).catch(() => {});
    }
  }

  return updatedCount;
}

export function markMessagesRead(recipientId, messageIds) {
  const db = getDb();
  const now = Date.now();
  let updatedCount = 0;
  const stmt = db.prepare(`
    UPDATE messages
    SET read_at = ?, delivered_at = COALESCE(delivered_at, ?)
    WHERE id = ? AND recipient_id = ? AND read_at IS NULL
  `);
  for (const id of messageIds) {
    const result = stmt.run(now, now, id, recipientId);
    if (result.changes > 0) {
      updatedCount += result.changes;
    }
  }

  if (tursoClient && messageIds.length > 0) {
    for (const id of messageIds) {
      tursoClient.execute({
        sql: `UPDATE messages SET read_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND recipient_id = ? AND read_at IS NULL`,
        args: [now, now, id, recipientId],
      }).catch(() => {});
    }
  }

  return updatedCount;
}

export function getStats() {
  const db = getDb();
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0;
  const messageCount = db.prepare('SELECT COUNT(*) AS count FROM messages').get()?.count || 0;
  return { users: userCount, messages: messageCount };
}

export function resetDatabase() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
  if (currentDbPath && fs.existsSync(currentDbPath)) {
    fs.unlinkSync(currentDbPath);
  }
}
