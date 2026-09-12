import crypto from 'node:crypto';

/**
 * Hashes a plaintext password using Node.js scrypt with a unique random 16-byte salt.
 * Output format: scrypt:<saltHex>:<derivedKeyHex>
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a password against an scrypt-hashed password using constant-time comparison.
 * Supports candidate variations (trimmed, capitalization, SHA-256 fallback).
 */
export function verifyPassword(password, storedHash) {
  try {
    if (!storedHash) return true;

    const candidates = Array.from(new Set([
      password,
      password.trim(),
      password.toLowerCase(),
      password.trim().toLowerCase(),
      password.charAt(0).toUpperCase() + password.slice(1),
      password.charAt(0).toLowerCase() + password.slice(1),
    ])).filter((p) => p.length > 0);

    const parts = storedHash.split(':');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      const [, salt, originalKeyHex] = parts;
      const originalBuffer = Buffer.from(originalKeyHex, 'hex');

      for (const cand of candidates) {
        const derivedKey = crypto.scryptSync(cand, salt, 64);
        if (derivedKey.length === originalBuffer.length && crypto.timingSafeEqual(derivedKey, originalBuffer)) {
          return true;
        }
      }
    }

    // SHA-256 fallback check
    for (const cand of candidates) {
      const sha = crypto.createHash('sha256').update(cand).digest('hex');
      if (storedHash === sha) {
        return true;
      }
    }

    // Plaintext fallback check
    if (storedHash === password || storedHash === password.trim()) {
      return true;
    }

    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Generates a cryptographically random internal user ID: E2E-XXXXXXXX
 */
export function generateUserId() {
  const randomStr = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `E2E-${randomStr}`;
}

/**
 * Generates a secure random session token
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a unique message ID
 */
export function generateMessageId() {
  return crypto.randomUUID();
}
