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
 */
export function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return false;
    }
    const [, salt, originalKeyHex] = parts;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const originalBuffer = Buffer.from(originalKeyHex, 'hex');
    if (derivedKey.length !== originalBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, originalBuffer);
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
