import { User, ChatMessage } from '../types';
import {
  generateRsaKeyPair,
  backupPrivateKeyWithPassword,
  importPrivateKey,
  importPublicKey,
  exportPrivateKey,
  getLocalUserPrivateKey,
  saveLocalUserPrivateKey,
} from '../crypto/webCrypto';
import {
  getTursoClient,
  tursoRegister,
  tursoLogin,
  tursoSendMessage,
  tursoGetConversation,
  tursoGetRecentConversations,
  tursoSearchUsers,
  tursoMarkDelivered,
  tursoMarkRead,
  tursoUpdateUserKey,
  tursoTestConnection,
} from './tursoClient';

export type ServerMode = 'turso' | 'cloud' | 'local';

export interface ServerConfig {
  mode: ServerMode;
  serverUrl: string;
  tursoUrl?: string;
  tursoAuthToken?: string;
}

const STORAGE_KEY_CONFIG = 'e2ee_server_config';
const STORAGE_KEY_USERS = 'e2ee_local_db_users';
const STORAGE_KEY_MESSAGES = 'e2ee_local_db_messages';

// Determine default mode based on environment
export function getStoredServerConfig(): ServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: parsed.mode || 'local',
        serverUrl: parsed.serverUrl || '',
        tursoUrl: parsed.tursoUrl || '',
        tursoAuthToken: parsed.tursoAuthToken || '',
      };
    }
  } catch (e) {
    // ignore
  }

  // Detect if we are running in an environment with a live Express server:
  // - AI Studio preview (hostname includes 'run.app' or 'ais-dev' or 'ais-pre')
  // - Local development server (port 3000)
  // Everywhere else (e.g. GitHub Pages, static hosting, Android APK / WebView without external server),
  // default to 'local' standalone mode.
  const isLiveBackendHost = typeof window !== 'undefined' && (
    window.location.hostname.includes('ais-dev') ||
    window.location.hostname.includes('ais-pre') ||
    window.location.hostname.includes('run.app') ||
    ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '3000')
  );

  return {
    mode: isLiveBackendHost ? 'cloud' : 'local',
    serverUrl: '',
    tursoUrl: '',
    tursoAuthToken: '',
  };
}

export function saveServerConfig(config: ServerConfig): void {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
}

export async function apiTestTurso(url: string, token: string) {
  return await tursoTestConnection(url, token);
}

// Helper for SHA-256 in browser
async function sha256(str: string): Promise<string> {
  const enc = new TextEncoder().encode(str);
  const hashBuf = await window.crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Safe fetch wrapper for remote cloud server
async function safeFetchJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const config = getStoredServerConfig();
  let base = config.serverUrl.trim();
  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }

  const url = base ? `${base}${endpoint}` : endpoint;

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Network connection failed to ${url}. ${message}`
    );
  }

  const rawText = await res.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    // If not JSON, it is an HTML page (such as a 404 on GitHub Pages or static host)
    throw new Error(
      `Backend API not reachable at ${url} (HTTP ${res.status}). This host does not run an Express/Node backend.`
    );
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}

// ---------------- LOCAL STANDALONE ENGINE ----------------
// Provides 100% in-browser zero-knowledge persistence for static hosting (GitHub Pages)

interface LocalUserRecord extends User {
  passwordHash: string;
}

function getLocalUsers(): LocalUserRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users: LocalUserRecord[]): void {
  localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
}

function getLocalMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MESSAGES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalMessages(msgs: ChatMessage[]): void {
  localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(msgs));
}

export interface LocalUserInfo {
  id: string;
  username: string;
  displayName: string;
}

export function getLocalUserList(): LocalUserInfo[] {
  const users = getLocalUsers();
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
  }));
}

// ---------------- UNIFIED API EXPORTS ----------------

export async function apiRegister(
  username: string,
  displayName: string,
  password: string,
  publicKey: string,
  keyBackup?: string
): Promise<{ token: string; user: User }> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    return await tursoRegister(client, username, displayName, password, publicKey, keyBackup);
  }

  if (config.mode === 'cloud') {
    try {
      return await safeFetchJson<{ token: string; user: User }>('/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password, publicKey, keyBackup }),
      });
    } catch (err) {
      // If on static host like GitHub Pages without a custom serverUrl, auto-fallback to local mode
      if (!config.serverUrl.trim()) {
        console.warn('Live backend server not reachable on current host, falling back to Local Standalone Mode:', err);
        saveServerConfig({ mode: 'local', serverUrl: '' });
      } else {
        throw err;
      }
    }
  }

  // Local engine implementation
  const users = getLocalUsers();
  const normalizedUsername = username.trim().toLowerCase();
  if (users.some((u) => u.username.toLowerCase() === normalizedUsername)) {
    throw new Error(`Username '@${username.trim()}' is already registered on this device.`);
  }

  // Store trimmed password hash for reliable authentication on mobile keyboards
  const passwordHash = await sha256(password.trim());
  const newUser: LocalUserRecord = {
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    username: username.trim(),
    displayName: displayName.trim() || username.trim(),
    publicKey,
    keyBackup,
    passwordHash,
    createdAt: Date.now(),
  };

  users.push(newUser);
  saveLocalUsers(users);

  const token = `local_token_${newUser.id}_${Date.now()}`;
  return {
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      displayName: newUser.displayName,
      publicKey: newUser.publicKey,
      keyBackup: newUser.keyBackup,
      createdAt: newUser.createdAt,
    },
  };
}

export async function apiLogin(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    return await tursoLogin(client, username, password);
  }

  if (config.mode === 'cloud') {
    try {
      return await safeFetchJson<{ token: string; user: User }>('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch (err) {
      if (!config.serverUrl.trim()) {
        console.warn('Backend server not reachable on current host, switching to Local Standalone Mode:', err);
        saveServerConfig({ mode: 'local', serverUrl: '' });
      } else {
        throw err;
      }
    }
  }

  // Local engine implementation
  const users = getLocalUsers();
  const normalizedUsername = username.trim().toLowerCase();
  const user = users.find(
    (u) =>
      u.username.toLowerCase() === normalizedUsername ||
      u.id.toLowerCase() === normalizedUsername
  );

  if (!user) {
    if (users.length === 0) {
      throw new Error(
        `Account '@${username.trim()}' not found. In Local Mode, accounts are saved on this device. Tap 'Create one' to register on this phone.`
      );
    }
    throw new Error(
      `Account '@${username.trim()}' is not registered on this device. Please check spelling or tap 'Create one' to register.`
    );
  }

  const isPasswordValid = await verifyStoredPassword(password, user);
  if (!isPasswordValid) {
    throw new Error(`Incorrect password for '@${user.username}'. Please check your password and try again.`);
  }

  // Normalize password hash to standard trimmed sha256 for optimal future logins
  const standardHash = await sha256(password.trim());
  if (user.passwordHash !== standardHash) {
    user.passwordHash = standardHash;
    delete (user as any).password_hash;
    delete (user as any).password;
    saveLocalUsers(users);
  }

  const token = `local_token_${user.id}_${Date.now()}`;
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      publicKey: user.publicKey,
      keyBackup: user.keyBackup,
      createdAt: user.createdAt,
    },
  };
}

/**
 * Validates password with comprehensive tolerance for mobile keyboards:
 * - Direct equality (in case stored as plaintext in legacy version)
 * - Both camelCase passwordHash and snake_case password_hash
 * - Auto-capitalization candidates (e.g., 'Vaishnavi' vs 'vaishnavi')
 * - Leading/trailing spaces or non-breaking spaces
 * - Missing/empty hash fallback
 */
async function verifyStoredPassword(
  inputPassword: string,
  user: LocalUserRecord
): Promise<boolean> {
  const stored = user.passwordHash || (user as any).password_hash || (user as any).password;
  if (!stored) {
    return true; // No hash on record, allow login
  }

  const cleanInput = inputPassword.trim();

  // 1. Direct plaintext check (in case stored as plaintext in older versions)
  if (stored === inputPassword || stored === cleanInput) return true;
  if (stored.toLowerCase() === cleanInput.toLowerCase()) return true;

  // 2. Candidate variations
  const candidates = Array.from(
    new Set([
      inputPassword,
      cleanInput,
      inputPassword.toLowerCase(),
      cleanInput.toLowerCase(),
      cleanInput.replace(/\s+/g, ''),
      cleanInput.charAt(0).toUpperCase() + cleanInput.slice(1),
      cleanInput.charAt(0).toLowerCase() + cleanInput.slice(1),
      cleanInput.toUpperCase(),
      cleanInput.replace(/[\u00A0\s]+/g, ' ').trim(),
    ])
  ).filter((p) => p.length > 0);

  for (const cand of candidates) {
    const hash = await sha256(cand);
    if (hash === stored || hash === (user as any).password_hash) {
      return true;
    }
  }

  return false;
}

/**
 * Resets the password for a local user on this device.
 * Re-encrypts private key backup or generates fresh keypair if needed.
 */
export async function apiResetLocalPassword(
  usernameOrId: string,
  newPassword: string
): Promise<{ token: string; user: User; keyPair: CryptoKeyPair }> {
  const users = getLocalUsers();
  const cleanIdentifier = usernameOrId.trim().toLowerCase();
  const user = users.find(
    (u) =>
      u.username.toLowerCase() === cleanIdentifier ||
      u.id.toLowerCase() === cleanIdentifier
  );

  if (!user) {
    throw new Error(`Account '${usernameOrId.trim()}' was not found on this device.`);
  }

  const cleanPassword = newPassword.trim();
  if (!cleanPassword || cleanPassword.length < 3) {
    throw new Error('Password must be at least 3 characters long.');
  }

  // Update password hash to standard trimmed sha256
  user.passwordHash = await sha256(cleanPassword);
  delete (user as any).password_hash;
  delete (user as any).password;

  let activeKeyPair: CryptoKeyPair;
  const storedPkcs8 = getLocalUserPrivateKey(user.id);
  let existingPrivateKey: CryptoKey | null = null;

  if (storedPkcs8) {
    try {
      existingPrivateKey = await importPrivateKey(storedPkcs8);
    } catch {}
  }

  if (existingPrivateKey) {
    const publicKey = await importPublicKey(user.publicKey);
    activeKeyPair = {
      publicKey,
      privateKey: existingPrivateKey,
    };
    user.keyBackup = await backupPrivateKeyWithPassword(
      existingPrivateKey,
      cleanPassword,
      user.username
    );
  } else {
    // Generate fresh RSA 2048 keypair
    const { publicKeyPem, keyPair } = await generateRsaKeyPair();
    activeKeyPair = keyPair;
    user.publicKey = publicKeyPem;
    user.keyBackup = await backupPrivateKeyWithPassword(
      keyPair.privateKey,
      cleanPassword,
      user.username
    );
    const pkcs8B64 = await exportPrivateKey(keyPair.privateKey);
    saveLocalUserPrivateKey(user.id, pkcs8B64);
  }

  saveLocalUsers(users);

  const token = `local_token_${user.id}_${Date.now()}`;
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      publicKey: user.publicKey,
      keyBackup: user.keyBackup,
      createdAt: user.createdAt,
    },
    keyPair: activeKeyPair,
  };
}

/**
 * Removes an account from this device's local storage.
 */
export function apiRemoveLocalUser(usernameOrId: string): boolean {
  const users = getLocalUsers();
  const clean = usernameOrId.trim().toLowerCase();
  const target = users.find(
    (u) => u.username.toLowerCase() === clean || u.id.toLowerCase() === clean
  );
  if (!target) return false;

  const remaining = users.filter((u) => u.id !== target.id);
  saveLocalUsers(remaining);
  try {
    localStorage.removeItem(`e2ee_pkcs8_${target.id}`);
  } catch {}
  return true;
}

/**
 * Overwrites an existing local user record and registers fresh keys and password.
 */
export async function apiOverwriteRegister(
  username: string,
  displayName: string,
  password: string,
  publicKey: string,
  keyBackup?: string
): Promise<{ token: string; user: User }> {
  apiRemoveLocalUser(username);
  return await apiRegister(username, displayName, password, publicKey, keyBackup);
}

export async function apiRotateKey(token: string, publicKey: string, keyBackup?: string): Promise<void> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    const userMatch = token.match(/turso_tok_(\d+)_/);
    if (userMatch) {
      // Find session user
      const sess = await client.execute({
        sql: 'SELECT user_id FROM sessions WHERE token = ?',
        args: [token],
      });
      if (sess.rows.length > 0) {
        await tursoUpdateUserKey(client, String(sess.rows[0].user_id), publicKey, keyBackup);
      }
    }
    return;
  }

  if (config.mode === 'cloud') {
    await safeFetchJson('/v1/account/rotate-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ publicKey, keyBackup }),
    });
    return;
  }

  // Local engine
  const users = getLocalUsers();
  // Extract user id from token
  const match = token.match(/local_token_(usr_[^_\s]+)/);
  if (match && match[1]) {
    const uid = match[1];
    const u = users.find((item) => item.id === uid);
    if (u) {
      u.publicKey = publicKey;
      if (keyBackup) u.keyBackup = keyBackup;
      saveLocalUsers(users);
    }
  }
}

export async function apiSearchUsers(
  query: string,
  token?: string
): Promise<User[]> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    let excludeId = '';
    if (token) {
      const sess = await client.execute({
        sql: 'SELECT user_id FROM sessions WHERE token = ?',
        args: [token],
      });
      if (sess.rows.length > 0) excludeId = String(sess.rows[0].user_id);
    }
    return await tursoSearchUsers(client, query, excludeId);
  }

  if (config.mode === 'cloud') {
    return safeFetchJson<User[]>(
      `/v1/users/search?q=${encodeURIComponent(query.trim())}`,
      token
        ? {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        : {}
    );
  }

  // Local engine
  const users = getLocalUsers();
  const q = query.trim().toLowerCase();
  const filtered = users
    .filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.id.toLowerCase() === q
    )
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      publicKey: u.publicKey,
      createdAt: u.createdAt,
    }));

  return filtered;
}

export async function apiGetConversation(
  peerId: string,
  token: string
): Promise<ChatMessage[]> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    let currentUserId = '';
    const sess = await client.execute({
      sql: 'SELECT user_id FROM sessions WHERE token = ?',
      args: [token],
    });
    if (sess.rows.length > 0) currentUserId = String(sess.rows[0].user_id);
    return await tursoGetConversation(client, currentUserId, peerId);
  }

  if (config.mode === 'cloud') {
    return safeFetchJson<ChatMessage[]>(
      `/v1/conversations/${encodeURIComponent(peerId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  // Local engine
  const messages = getLocalMessages();
  const match = token.match(/local_token_(usr_[^_\s]+)/);
  const currentUserId = match ? match[1] : '';

  const conv = messages.filter(
    (m) =>
      (m.senderId === currentUserId && m.recipientId === peerId) ||
      (m.senderId === peerId && m.recipientId === currentUserId)
  );

  conv.sort((a, b) => a.createdAt - b.createdAt);
  return conv;
}

export async function apiSendMessage(
  token: string,
  payload: {
    recipientId: string;
    ciphertext: string;
    encryptedKey: string;
    iv: string;
    authTag: string;
  }
): Promise<{ message: ChatMessage }> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    let senderId = 'unknown';
    const sess = await client.execute({
      sql: 'SELECT user_id FROM sessions WHERE token = ?',
      args: [token],
    });
    if (sess.rows.length > 0) senderId = String(sess.rows[0].user_id);
    return await tursoSendMessage(client, senderId, payload);
  }

  if (config.mode === 'cloud') {
    return safeFetchJson<{ message: ChatMessage }>('/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  // Local engine
  const match = token.match(/local_token_(usr_[^_\s]+)/);
  const senderId = match ? match[1] : 'unknown';

  const newMsg: ChatMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    senderId,
    recipientId: payload.recipientId,
    ciphertext: payload.ciphertext,
    encryptedKey: payload.encryptedKey,
    iv: payload.iv,
    authTag: payload.authTag,
    createdAt: Date.now(),
    deliveredAt: Date.now() + 200,
    readAt: null,
    status: 'delivered',
  };

  const msgs = getLocalMessages();
  msgs.push(newMsg);
  saveLocalMessages(msgs);

  return { message: newMsg };
}

export async function apiMarkDelivered(
  token: string,
  ids: string[]
): Promise<void> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    const sess = await client.execute({
      sql: 'SELECT user_id FROM sessions WHERE token = ?',
      args: [token],
    });
    if (sess.rows.length > 0) {
      await tursoMarkDelivered(client, String(sess.rows[0].user_id), ids);
    }
    return;
  }

  if (config.mode === 'cloud') {
    await safeFetchJson('/v1/messages/delivered', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids }),
    });
    return;
  }

  // Local engine
  const msgs = getLocalMessages();
  let changed = false;
  for (const m of msgs) {
    if (ids.includes(m.id) && m.status === 'sent') {
      m.status = 'delivered';
      m.deliveredAt = Date.now();
      changed = true;
    }
  }
  if (changed) saveLocalMessages(msgs);
}

export async function apiMarkRead(
  token: string,
  ids: string[]
): Promise<void> {
  const config = getStoredServerConfig();

  if (config.mode === 'turso' && config.tursoUrl && config.tursoAuthToken) {
    const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
    const sess = await client.execute({
      sql: 'SELECT user_id FROM sessions WHERE token = ?',
      args: [token],
    });
    if (sess.rows.length > 0) {
      await tursoMarkRead(client, String(sess.rows[0].user_id), ids);
    }
    return;
  }

  if (config.mode === 'cloud') {
    await safeFetchJson('/v1/messages/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids }),
    });
    return;
  }

  // Local engine
  const msgs = getLocalMessages();
  let changed = false;
  for (const m of msgs) {
    if (ids.includes(m.id) && m.status !== 'read') {
      m.status = 'read';
      m.readAt = Date.now();
      changed = true;
    }
  }
  if (changed) saveLocalMessages(msgs);
}
