import { findSession } from './database.js';

/**
 * Express middleware to authenticate Bearer token.
 * Populates req.user with authenticated user record and req.session with session info.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Missing or invalid Bearer token.' });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  const session = findSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  req.session = session;
  req.user = {
    id: session.id,
    username: session.username,
    displayName: session.displayName,
    publicKey: session.publicKey,
    keyBackup: session.keyBackup,
  };

  next();
}
