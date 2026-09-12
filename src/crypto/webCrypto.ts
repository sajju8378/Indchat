/**
 * Web Cryptography API implementation matching the Android & Server E2EE specifications:
 * - RSA 2048-bit key pair
 * - AES-256-GCM for message payload encryption
 * - RSA-OAEP with SHA-256 for wrapping the AES key
 * - Random 12-byte IV for every message
 * - Base64 transport encoding
 */

export interface EncryptedEnvelope {
  recipientId: string;
  encryptedKey: string;
  ciphertext: string;
  iv: string;
  authTag: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function spkiToPem(spkiBuffer: ArrayBuffer): string {
  const b64 = arrayBufferToBase64(spkiBuffer);
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

export function pemToSpki(pem: string): Uint8Array {
  const clean = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  return base64ToArrayBuffer(clean);
}

export async function generateRsaKeyPair(): Promise<{
  publicKeyPem: string;
  keyPair: CryptoKeyPair;
}> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyPem = spkiToPem(spki);

  return { publicKeyPem, keyPair };
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const spki = pemToSpki(pem);
  return await window.crypto.subtle.importKey(
    'spki',
    spki,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt']
  );
}

export async function encryptEnvelope(
  plaintext: string,
  recipientPublicKeyPem: string,
  recipientId: string
): Promise<EncryptedEnvelope> {
  const recipientKey = await importPublicKey(recipientPublicKeyPem);

  // 1. Generate random 256-bit AES key and 12-byte IV
  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // 2. Encrypt plaintext with AES-GCM
  const encodedText = new TextEncoder().encode(plaintext);
  const cipherAndTagBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    encodedText
  );

  const cipherAndTag = new Uint8Array(cipherAndTagBuffer);
  const tagLength = 16;
  const ciphertextLength = cipherAndTag.length - tagLength;
  const ciphertextBytes = cipherAndTag.slice(0, ciphertextLength);
  const authTagBytes = cipherAndTag.slice(ciphertextLength);

  // 3. Encrypt raw AES key using recipient's RSA-OAEP public key
  const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
  const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientKey,
    rawAesKey
  );

  return {
    recipientId,
    encryptedKey: arrayBufferToBase64(encryptedKeyBuffer),
    ciphertext: arrayBufferToBase64(ciphertextBytes),
    iv: arrayBufferToBase64(iv),
    authTag: arrayBufferToBase64(authTagBytes),
  };
}

export async function decryptEnvelope(
  envelope: {
    encryptedKey: string;
    ciphertext: string;
    iv: string;
    authTag: string;
  },
  privateKey: CryptoKey
): Promise<string> {
  // 1. Decrypt AES key with RSA-OAEP
  const encryptedKeyBytes = base64ToArrayBuffer(envelope.encryptedKey);
  const rawAesKey = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedKeyBytes
  );

  // 2. Import decrypted AES key
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // 3. Combine ciphertext and authTag
  const cipherBytes = base64ToArrayBuffer(envelope.ciphertext);
  const tagBytes = base64ToArrayBuffer(envelope.authTag);
  const combined = new Uint8Array(cipherBytes.length + tagBytes.length);
  combined.set(cipherBytes, 0);
  combined.set(tagBytes, cipherBytes.length);

  const ivBytes = base64ToArrayBuffer(envelope.iv);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, tagLength: 128 },
    aesKey,
    combined
  );

  return new TextDecoder().decode(decryptedBuffer);
}
