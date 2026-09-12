import { ActiveSession, User } from '../types';
import { exportPrivateKey, importPrivateKey, importPublicKey } from '../crypto/webCrypto';

const STORAGE_KEY_SESSION = 'e2ee_active_session_v1';

interface SerializedSession {
  token: string;
  user: User;
  privateKeyB64: string;
}

export async function saveStoredSession(session: ActiveSession): Promise<void> {
  try {
    const privateKeyB64 = await exportPrivateKey(session.keyPair.privateKey);
    const serialized: SerializedSession = {
      token: session.token,
      user: session.user,
      privateKeyB64,
    };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(serialized));
  } catch (err) {
    console.warn('Failed to persist active session to localStorage:', err);
  }
}

export async function getStoredSession(): Promise<ActiveSession | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!raw) return null;

    const parsed: SerializedSession = JSON.parse(raw);
    if (!parsed.token || !parsed.user || !parsed.privateKeyB64 || !parsed.user.publicKey) {
      return null;
    }

    const publicKey = await importPublicKey(parsed.user.publicKey);
    const privateKey = await importPrivateKey(parsed.privateKeyB64);

    return {
      token: parsed.token,
      user: parsed.user,
      keyPair: {
        publicKey,
        privateKey,
      },
    };
  } catch (err) {
    console.warn('Failed to restore active session from localStorage:', err);
    return null;
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_SESSION);
  } catch {
    // ignore
  }
}
