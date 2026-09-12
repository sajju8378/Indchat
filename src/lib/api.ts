import { User, ChatMessage } from '../types';

export type ServerMode = 'cloud' | 'local';

export interface ServerConfig {
  mode: ServerMode;
  serverUrl: string;
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
      };
    }
  } catch (e) {
    // ignore
  }

  // If hosted on github.io or static preview without local backend: default to local mode
  const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.includes('github.io');
  return {
    mode: isGitHubPages ? 'local' : 'cloud',
    serverUrl: '',
  };
}

export function saveServerConfig(config: ServerConfig): void {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
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
      `Network connection failed to ${url}. ${message}. If using GitHub Pages, switch to "Local Standalone Mode" in Server Settings.`
    );
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    if (text.includes('<!doctype') || text.includes('<html') || res.status === 404) {
      throw new Error(
        `Backend endpoint not found (${res.status}). GitHub Pages is a static host and cannot run Node.js backend APIs. Tap 'Server Settings' below to switch to 'Local Standalone Mode' or enter your live server URL.`
      );
    }
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
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

// ---------------- UNIFIED API EXPORTS ----------------

export async function apiRegister(
  username: string,
  displayName: string,
  password: string,
  publicKey: string
): Promise<{ token: string; user: User }> {
  const config = getStoredServerConfig();

  if (config.mode === 'cloud') {
    return safeFetchJson<{ token: string; user: User }>('/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, publicKey }),
    });
  }

  // Local engine implementation
  const users = getLocalUsers();
  const normalizedUsername = username.trim().toLowerCase();
  if (users.some((u) => u.username.toLowerCase() === normalizedUsername)) {
    throw new Error('Username is already registered. Please choose another.');
  }

  const passwordHash = await sha256(password);
  const newUser: LocalUserRecord = {
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    username: username.trim(),
    displayName: displayName.trim() || username.trim(),
    publicKey,
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
      createdAt: newUser.createdAt,
    },
  };
}

export async function apiLogin(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  const config = getStoredServerConfig();

  if (config.mode === 'cloud') {
    return safeFetchJson<{ token: string; user: User }>('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }

  // Local engine implementation
  const users = getLocalUsers();
  const normalizedUsername = username.trim().toLowerCase();
  const user = users.find(
    (u) => u.username.toLowerCase() === normalizedUsername || u.id === username.trim()
  );

  if (!user) {
    throw new Error('Invalid username or password.');
  }

  const hash = await sha256(password);
  if (user.passwordHash !== hash) {
    throw new Error('Invalid username or password.');
  }

  const token = `local_token_${user.id}_${Date.now()}`;
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      publicKey: user.publicKey,
      createdAt: user.createdAt,
    },
  };
}

export async function apiRotateKey(token: string, publicKey: string): Promise<void> {
  const config = getStoredServerConfig();
  if (config.mode === 'cloud') {
    await safeFetchJson('/v1/account/rotate-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ publicKey }),
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
      saveLocalUsers(users);
    }
  }
}

export async function apiSearchUsers(
  query: string,
  token?: string
): Promise<User[]> {
  const config = getStoredServerConfig();

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
