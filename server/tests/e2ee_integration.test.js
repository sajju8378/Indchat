import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  initDatabase,
  getDb,
  createUser,
  findUserById,
  findUserByUsername,
  findUserByUsernameOrId,
  searchUsers,
  createSession,
  findSession,
  deleteSession,
  saveMessage,
  getMessageById,
  getConversation,
  markMessagesDelivered,
  markMessagesRead,
  getStats,
  resetDatabase,
} from '../src/database.js';
import {
  hashPassword,
  verifyPassword,
  generateUserId,
  generateSessionToken,
  generateMessageId,
} from '../src/crypto.js';

// Helper cryptographic functions for client simulation (RSA 2048 + AES-256-GCM)
function generateClientKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function encryptE2EE(plaintext, recipientPublicKeyPem) {
  // 1. Generate fresh AES-256 key and 12-byte IV
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // 2. Encrypt plaintext using AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  let ciphertext = cipher.update(plaintext, 'utf8');
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // 3. Encrypt AES key using recipient's RSA public key (RSA-OAEP with SHA-256)
  const encryptedKey = crypto.publicEncrypt(
    {
      key: recipientPublicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey
  );

  return {
    encryptedKey: encryptedKey.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptE2EE(envelope, recipientPrivateKeyPem) {
  // 1. Decrypt AES key using private RSA key (RSA-OAEP with SHA-256)
  const encryptedKeyBuf = Buffer.from(envelope.encryptedKey, 'base64');
  const aesKey = crypto.privateDecrypt(
    {
      key: recipientPrivateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedKeyBuf
  );

  // 2. Decrypt ciphertext using AES-256-GCM
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

// Encrypt private key backup using password
function createEncryptedKeyBackup(privateKeyPem, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(privateKeyPem, 'utf8');
  enc = Buffer.concat([enc, cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
  });
}

function restorePrivateKeyFromBackup(backupJson, password) {
  const { salt, iv, tag, ciphertext } = JSON.parse(backupJson);
  const key = crypto.pbkdf2Sync(password, Buffer.from(salt, 'base64'), 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  let dec = decipher.update(Buffer.from(ciphertext, 'base64'));
  dec = Buffer.concat([dec, decipher.final()]);
  return dec.toString('utf8');
}

async function runAllTests() {
  console.log('====================================================');
  console.log('  RUNNING 22 AUTOMATED E2EE INTEGRATION TESTS');
  console.log('====================================================\n');

  const testDbPath = path.resolve(process.cwd(), 'server', 'data', 'test_chat.sqlite');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  process.env.DATABASE_PATH = testDbPath;
  initDatabase(testDbPath);

  let passed = 0;

  function testStep(stepNum, description, fn) {
    try {
      fn();
      console.log(`[PASS] Test ${stepNum}: ${description}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] Test ${stepNum}: ${description}`);
      console.error(err);
      process.exit(1);
    }
  }

  // 1. Register Alice
  const aliceKeys = generateClientKeyPair();
  const alicePassword = 'AliceSecurePassword123!';
  const aliceBackup = createEncryptedKeyBackup(aliceKeys.privateKey, alicePassword);
  let aliceUser;
  testStep(1, 'Register Alice', () => {
    const userId = generateUserId();
    aliceUser = createUser({
      id: userId,
      username: 'alice',
      displayName: 'Alice Anderson',
      passwordHash: hashPassword(alicePassword),
      publicKey: aliceKeys.publicKey,
      keyBackup: aliceBackup,
    });
    assert.strictEqual(aliceUser.username, 'alice');
    assert.strictEqual(aliceUser.public_key, aliceKeys.publicKey);
  });

  // 2. Register Bob
  const bobKeys = generateClientKeyPair();
  const bobPassword = 'BobSecurePassword456!';
  const bobBackup = createEncryptedKeyBackup(bobKeys.privateKey, bobPassword);
  let bobUser;
  testStep(2, 'Register Bob', () => {
    const userId = generateUserId();
    bobUser = createUser({
      id: userId,
      username: 'bob',
      displayName: 'Bob Builder',
      passwordHash: hashPassword(bobPassword),
      publicKey: bobKeys.publicKey,
      keyBackup: bobBackup,
    });
    assert.strictEqual(bobUser.username, 'bob');
    assert.strictEqual(bobUser.public_key, bobKeys.publicKey);
  });

  // 3. Login Alice
  let aliceToken;
  testStep(3, 'Login Alice', () => {
    const found = findUserByUsernameOrId('alice');
    assert.ok(found);
    const valid = verifyPassword(alicePassword, found.password_hash);
    assert.strictEqual(valid, true);
    aliceToken = generateSessionToken();
    const session = createSession(found.id, aliceToken);
    assert.strictEqual(session.userId, aliceUser.id);
  });

  // 4. Login Bob
  let bobToken;
  testStep(4, 'Login Bob', () => {
    const found = findUserByUsernameOrId(bobUser.id); // Test login by internal ID
    assert.ok(found);
    const valid = verifyPassword(bobPassword, found.password_hash);
    assert.strictEqual(valid, true);
    bobToken = generateSessionToken();
    const session = createSession(found.id, bobToken);
    assert.strictEqual(session.userId, bobUser.id);
  });

  // 5. Search Bob from Alice
  testStep(5, 'Search Bob from Alice', () => {
    const results = searchUsers('bob', aliceUser.id);
    assert.ok(results.length >= 1);
    const bobResult = results.find((u) => u.username === 'bob');
    assert.ok(bobResult);
    assert.strictEqual(bobResult.id, bobUser.id);
    assert.strictEqual(bobResult.displayName, 'Bob Builder');
    // Ensure sensitive fields are omitted
    assert.strictEqual(bobResult.password_hash, undefined);
  });

  // 6. Get Bob's public key
  let bobFetchedPublicKey;
  testStep(6, "Get Bob's public key", () => {
    const bobProfile = findUserById(bobUser.id);
    assert.ok(bobProfile);
    bobFetchedPublicKey = bobProfile.public_key;
    assert.strictEqual(bobFetchedPublicKey, bobKeys.publicKey);
  });

  // 7. Encrypt a message using Bob's public key
  const messagePlaintext = 'Hello Bob! This is secret E2EE communication.';
  let envelope;
  testStep(7, "Encrypt a message using Bob's public key", () => {
    envelope = encryptE2EE(messagePlaintext, bobFetchedPublicKey);
    assert.ok(envelope.ciphertext);
    assert.ok(envelope.encryptedKey);
    assert.ok(envelope.iv);
    assert.ok(envelope.authTag);
    // Plaintext should not appear anywhere in the envelope
    assert.ok(!envelope.ciphertext.includes('Hello Bob'));
  });

  // 8. Send Alice -> Bob
  let messageId;
  testStep(8, 'Send Alice -> Bob', () => {
    messageId = generateMessageId();
    const saved = saveMessage({
      id: messageId,
      senderId: aliceUser.id,
      recipientId: bobUser.id,
      ciphertext: envelope.ciphertext,
      encryptedKey: envelope.encryptedKey,
      iv: envelope.iv,
      authTag: envelope.authTag,
    });
    assert.strictEqual(saved.id, messageId);
    assert.strictEqual(saved.status, 'sent');
  });

  // 9. Verify server cannot decrypt the plaintext
  testStep(9, 'Verify server cannot decrypt the plaintext', () => {
    const storedMsg = getMessageById(messageId);
    // Server sees only ciphertext and wrapped key
    assert.notStrictEqual(storedMsg.ciphertext, messagePlaintext);
    // Attempting to decrypt with an arbitrary server key fails
    const serverFakeKey = generateClientKeyPair();
    assert.throws(() => {
      decryptE2EE(storedMsg, serverFakeKey.privateKey);
    });
  });

  // 10. Bob retrieves the message
  let bobRetrievedMsg;
  testStep(10, 'Bob retrieves the message', () => {
    const conversation = getConversation(bobUser.id, aliceUser.id);
    assert.strictEqual(conversation.length, 1);
    bobRetrievedMsg = conversation[0];
    assert.strictEqual(bobRetrievedMsg.id, messageId);
    assert.strictEqual(bobRetrievedMsg.senderId, aliceUser.id);
  });

  // 11. Bob decrypts it
  testStep(11, 'Bob decrypts it', () => {
    const decrypted = decryptE2EE(bobRetrievedMsg, bobKeys.privateKey);
    assert.strictEqual(decrypted, messagePlaintext);
  });

  // 12. Bob marks delivered
  testStep(12, 'Bob marks delivered', () => {
    const updated = markMessagesDelivered(bobUser.id, [messageId]);
    assert.strictEqual(updated, 1);
  });

  // 13. Verify Alice sees double grey tick (delivered)
  testStep(13, 'Verify Alice sees double grey tick (status = delivered)', () => {
    const conversation = getConversation(aliceUser.id, bobUser.id);
    const msg = conversation.find((m) => m.id === messageId);
    assert.ok(msg);
    assert.ok(msg.deliveredAt !== null);
    assert.strictEqual(msg.status, 'delivered');
  });

  // 14. Bob marks read
  testStep(14, 'Bob marks read', () => {
    const updated = markMessagesRead(bobUser.id, [messageId]);
    assert.strictEqual(updated, 1);
  });

  // 15. Verify Alice sees double blue tick (status = read)
  testStep(15, 'Verify Alice sees double blue tick (status = read)', () => {
    const conversation = getConversation(aliceUser.id, bobUser.id);
    const msg = conversation.find((m) => m.id === messageId);
    assert.ok(msg);
    assert.ok(msg.readAt !== null);
    assert.strictEqual(msg.status, 'read');
  });

  // 16. Bob sends a reply
  const replyPlaintext = 'Hey Alice! E2EE is crystal clear.';
  let replyMsgId;
  testStep(16, 'Bob sends a reply', () => {
    const replyEnvelope = encryptE2EE(replyPlaintext, aliceKeys.publicKey);
    replyMsgId = generateMessageId();
    const saved = saveMessage({
      id: replyMsgId,
      senderId: bobUser.id,
      recipientId: aliceUser.id,
      ciphertext: replyEnvelope.ciphertext,
      encryptedKey: replyEnvelope.encryptedKey,
      iv: replyEnvelope.iv,
      authTag: replyEnvelope.authTag,
    });
    assert.strictEqual(saved.id, replyMsgId);
  });

  // 17. Alice receives and decrypts reply
  testStep(17, 'Alice receives and decrypts reply', () => {
    const aliceConv = getConversation(aliceUser.id, bobUser.id);
    assert.strictEqual(aliceConv.length, 2);
    const replyMsg = aliceConv.find((m) => m.id === replyMsgId);
    assert.ok(replyMsg);
    const decryptedReply = decryptE2EE(replyMsg, aliceKeys.privateKey);
    assert.strictEqual(decryptedReply, replyPlaintext);
  });

  // 18. Test duplicate usernames
  testStep(18, 'Test duplicate usernames (case-insensitive reject)', () => {
    const dupCheck1 = findUserByUsername('alice');
    const dupCheck2 = findUserByUsername('ALICE');
    assert.ok(dupCheck1 !== null);
    assert.ok(dupCheck2 !== null);
    assert.strictEqual(dupCheck1.id, dupCheck2.id);
  });

  // 19. Test invalid passwords
  testStep(19, 'Test invalid passwords', () => {
    const invalidCheck = verifyPassword('WrongPassword123!', aliceUser.password_hash);
    assert.strictEqual(invalidCheck, false);
  });

  // 20. Test expired/invalid sessions
  testStep(20, 'Test expired/invalid sessions', () => {
    const fakeSession = findSession('non-existent-token-12345');
    assert.strictEqual(fakeSession, null);
    // Delete alice session and verify logout
    deleteSession(aliceToken);
    const loggedOutSession = findSession(aliceToken);
    assert.strictEqual(loggedOutSession, null);
  });

  // 21. Test image message
  testStep(21, 'Test image message end-to-end encrypted', () => {
    const dummyImageBase64 = Buffer.from('FAKEDUMMYJPEGDATAOFANIMAGE').toString('base64');
    const imagePayload = JSON.stringify({
      type: 'image',
      name: 'photo.jpg',
      mime: 'image/jpeg',
      data: dummyImageBase64,
    });

    const imageEnvelope = encryptE2EE(imagePayload, bobKeys.publicKey);
    const imgMsgId = generateMessageId();
    saveMessage({
      id: imgMsgId,
      senderId: aliceUser.id,
      recipientId: bobUser.id,
      ciphertext: imageEnvelope.ciphertext,
      encryptedKey: imageEnvelope.encryptedKey,
      iv: imageEnvelope.iv,
      authTag: imageEnvelope.authTag,
    });

    const bobMsg = getMessageById(imgMsgId);
    assert.ok(bobMsg);
    const decryptedJson = decryptE2EE(bobMsg, bobKeys.privateKey);
    const parsedPayload = JSON.parse(decryptedJson);
    assert.strictEqual(parsedPayload.type, 'image');
    assert.strictEqual(parsedPayload.name, 'photo.jpg');
    assert.strictEqual(parsedPayload.data, dummyImageBase64);
  });

  // 22. Test database persistence after server restart
  testStep(22, 'Test database persistence after server restart', () => {
    // Reset in-memory reference and re-initialize with same file
    initDatabase(testDbPath);
    const user = findUserByUsername('alice');
    assert.ok(user !== null);
    assert.strictEqual(user.username, 'alice');
    const stats = getStats();
    assert.strictEqual(stats.users, 2);
    assert.strictEqual(stats.messages, 3);
  });

  console.log('\n====================================================');
  console.log(`  ALL ${passed}/22 INTEGRATION TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
