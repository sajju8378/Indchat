import express from 'express';
import { requireAuth } from './auth.js';
import {
  createUser,
  findUserById,
  findUserByUsername,
  findUserByUsernameOrId,
  searchUsers,
  createSession,
  deleteSession,
  saveMessage,
  getMessageById,
  getConversation,
  getRecentConversations,
  markMessagesDelivered,
  markMessagesRead,
  updateUserKey,
  updateKeyBackup,
  getStats,
  getTursoStatus,
  connectTurso,
} from './database.js';
import {
  hashPassword,
  verifyPassword,
  generateUserId,
  generateSessionToken,
  generateMessageId,
} from './crypto.js';
import { getActiveCalls, isUserOnline } from './signaling.js';

export const router = express.Router();

// Username validation regex: 3-20 chars, starts with letter, only A-Z, a-z, 0-9, _
const USERNAME_REGEX = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

// Public health check
router.get(['/health', '/v1/health', '/api/health'], (req, res) => {
  const stats = getStats();
  const turso = getTursoStatus();
  res.json({
    status: 'ok',
    ok: true,
    database: turso.configured ? 'turso' : 'sqlite',
    turso,
    users: stats.users,
    messages: stats.messages,
  });
});

// Database status check
router.get(['/api/database/status', '/v1/database/status'], (req, res) => {
  const stats = getStats();
  const turso = getTursoStatus();
  res.json({
    ok: true,
    database: turso.configured ? 'turso' : 'sqlite',
    turso,
    users: stats.users,
    messages: stats.messages,
  });
});

// Connect to Turso DB dynamically
router.post(['/api/database/turso-connect', '/v1/database/turso-connect'], async (req, res) => {
  const { url, authToken, token } = req.body || {};
  const targetToken = authToken || token || '';
  if (!url) {
    return res.status(400).json({ error: 'Turso database URL is required.' });
  }
  const result = await connectTurso(url, targetToken);
  if (result.ok) {
    const stats = getStats();
    res.json({ ...result, stats });
  } else {
    res.status(400).json(result);
  }
});

// Register
router.post('/v1/auth/register', (req, res) => {
  const { username, displayName, password, publicKey, keyBackup } = req.body || {};

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required.' });
  }

  const trimmedUsername = username.trim();
  if (!USERNAME_REGEX.test(trimmedUsername)) {
    return res.status(400).json({
      error: 'Username must be 3-20 characters, start with a letter, and contain only letters, numbers, and underscores.',
    });
  }

  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    return res.status(400).json({ error: 'Display name is required.' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Public encryption key is required.' });
  }

  // Check unique username (case-insensitive)
  const existing = findUserByUsername(trimmedUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
  }

  const userId = generateUserId();
  const passwordHash = hashPassword(password);

  try {
    const newUser = createUser({
      id: userId,
      username: trimmedUsername,
      displayName: displayName.trim(),
      passwordHash,
      publicKey,
      keyBackup: keyBackup || null,
    });

    const token = generateSessionToken();
    createSession(newUser.id, token);

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        displayName: newUser.display_name,
        publicKey: newUser.public_key,
        keyBackup: newUser.key_backup,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

// Login
router.post('/v1/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/ID and password are required.' });
  }

  const user = findUserByUsernameOrId(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const isValid = verifyPassword(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const token = generateSessionToken();
  createSession(user.id, token);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      publicKey: user.public_key,
      keyBackup: user.key_backup,
    },
  });
});

// Logout
router.post('/v1/auth/logout', requireAuth, (req, res) => {
  deleteSession(req.session.token);
  res.json({ ok: true, message: 'Logged out successfully.' });
});

// Search users
router.get('/v1/users/search', requireAuth, (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.json([]);
  }

  const results = searchUsers(q.trim(), req.user.id);
  res.json(results);
});

// Get user profile
router.get('/v1/users/:id', requireAuth, (req, res) => {
  const user = findUserByUsernameOrId(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    publicKey: user.public_key,
  });
});

// Send message
router.post('/v1/messages', requireAuth, (req, res) => {
  const { recipientId, encryptedKey, ciphertext, iv, authTag } = req.body || {};

  if (!recipientId || !encryptedKey || !ciphertext || !iv || !authTag) {
    return res.status(400).json({
      error: 'Missing required message envelope fields (recipientId, encryptedKey, ciphertext, iv, authTag).',
    });
  }

  const recipient = findUserById(recipientId) || findUserByUsername(recipientId);
  if (!recipient) {
    return res.status(404).json({ error: 'Recipient user not found.' });
  }

  const messageId = generateMessageId();
  const saved = saveMessage({
    id: messageId,
    senderId: req.user.id, // Strictly server-assigned
    recipientId: recipient.id,
    ciphertext,
    encryptedKey,
    iv,
    authTag,
  });

  res.status(201).json({ message: saved });
});

// Get conversation messages
router.get('/v1/conversations/:peer', requireAuth, (req, res) => {
  const peer = findUserByUsernameOrId(req.params.peer);
  if (!peer) {
    return res.status(404).json({ error: 'Peer user not found.' });
  }

  const messages = getConversation(req.user.id, peer.id);
  res.json(messages);
});

// Get recent conversations
router.get('/v1/conversations', requireAuth, (req, res) => {
  const recent = getRecentConversations(req.user.id);
  res.json(recent);
});

// Get message by ID
router.get('/v1/messages/:id', requireAuth, (req, res) => {
  const message = getMessageById(req.params.id);
  if (!message) {
    return res.status(404).json({ error: 'Message not found.' });
  }

  if (message.senderId !== req.user.id && message.recipientId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied to this message.' });
  }

  res.json(message);
});

// Mark messages delivered
router.post('/v1/messages/delivered', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Array of message IDs required.' });
  }

  const updated = markMessagesDelivered(req.user.id, ids);
  res.json({ ok: true, updated });
});

// Mark messages read
router.post('/v1/messages/read', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Array of message IDs required.' });
  }

  const updated = markMessagesRead(req.user.id, ids);
  res.json({ ok: true, updated });
});

// Rotate public key
router.post('/v1/account/rotate-key', requireAuth, (req, res) => {
  const { publicKey, keyBackup } = req.body || {};
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'New public key is required.' });
  }

  const updatedUser = updateUserKey(req.user.id, publicKey, keyBackup);
  res.json({
    ok: true,
    user: {
      id: updatedUser.id,
      username: updatedUser.username,
      displayName: updatedUser.display_name,
      publicKey: updatedUser.public_key,
      keyBackup: updatedUser.key_backup,
    },
  });
});

// Update encrypted key backup
router.post('/v1/account/key-backup', requireAuth, (req, res) => {
  const { keyBackup } = req.body || {};
  if (!keyBackup || typeof keyBackup !== 'string') {
    return res.status(400).json({ error: 'Encrypted key backup data required.' });
  }

  const updatedUser = updateKeyBackup(req.user.id, keyBackup);
  res.json({
    ok: true,
    user: {
      id: updatedUser.id,
      username: updatedUser.username,
      displayName: updatedUser.display_name,
      publicKey: updatedUser.public_key,
      keyBackup: updatedUser.key_backup,
    },
  });
});

// Check peer online / call status
router.get('/v1/calls/online/:userId', requireAuth, (req, res) => {
  const online = isUserOnline(req.params.userId);
  res.json({ ok: true, userId: req.params.userId, online });
});

// REST Fallback for WebRTC Signaling
router.post('/v1/calls/offer', requireAuth, (req, res) => {
  const { callId, toUserId, callType, offer } = req.body || {};
  if (!callId || !toUserId || !offer) {
    return res.status(400).json({ error: 'callId, toUserId, and offer are required.' });
  }

  const activeCalls = getActiveCalls();
  activeCalls.set(callId, {
    callId,
    fromUser: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
    },
    toUserId,
    callType: callType || 'audio',
    offer,
    answer: null,
    candidates: [],
    status: 'ringing',
    updatedAt: Date.now(),
  });

  res.json({ ok: true, callId, status: 'ringing' });
});

router.get('/v1/calls/poll', requireAuth, (req, res) => {
  const userId = req.user.id;
  const activeCalls = getActiveCalls();

  // Find any incoming calls for this user
  let incoming = null;
  for (const [callId, call] of activeCalls.entries()) {
    if (call.toUserId === userId && call.status === 'ringing') {
      incoming = call;
      break;
    }
  }

  // Also check if any call initiated by this user has an answer or has ended
  let myCall = null;
  const requestedCallId = req.query.callId;
  if (requestedCallId && activeCalls.has(requestedCallId)) {
    myCall = activeCalls.get(requestedCallId);
  }

  res.json({
    ok: true,
    incoming,
    myCall,
  });
});

router.post('/v1/calls/answer', requireAuth, (req, res) => {
  const { callId, answer } = req.body || {};
  const activeCalls = getActiveCalls();
  const call = activeCalls.get(callId);
  if (!call) {
    return res.status(404).json({ error: 'Call not found or expired.' });
  }

  call.answer = answer;
  call.status = 'connected';
  call.updatedAt = Date.now();
  res.json({ ok: true, status: 'connected' });
});

const handleCandidate = (req, res) => {
  const { callId, toUserId, candidate } = req.body || {};
  const activeCalls = getActiveCalls();
  const call = activeCalls.get(callId);
  if (call) {
    call.candidates.push({ toUserId, candidate });
    call.updatedAt = Date.now();
  }
  res.json({ ok: true });
};

router.post('/v1/calls/candidate', requireAuth, handleCandidate);
router.post('/v1/calls/ice-candidate', requireAuth, handleCandidate);

router.post('/v1/calls/reject', requireAuth, (req, res) => {
  const { callId } = req.body || {};
  const activeCalls = getActiveCalls();
  const call = activeCalls.get(callId);
  if (call) {
    call.status = 'rejected';
    call.updatedAt = Date.now();
  }
  res.json({ ok: true, status: 'rejected' });
});

router.post('/v1/calls/end', requireAuth, (req, res) => {
  const { callId } = req.body || {};
  const activeCalls = getActiveCalls();
  const call = activeCalls.get(callId);
  if (call) {
    call.status = 'ended';
    call.updatedAt = Date.now();
  }
  res.json({ ok: true, status: 'ended' });
});

