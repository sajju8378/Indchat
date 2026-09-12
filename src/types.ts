export interface User {
  id: string;
  username: string;
  displayName: string;
  publicKey: string;
  keyBackup?: string;
  createdAt?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
  createdAt: number;
  deliveredAt?: number | null;
  readAt?: number | null;
  status: 'sent' | 'delivered' | 'read';
  cachedText?: string;
  cachedImage?: string;
}

export interface DecryptedUIMessage {
  id: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  status: 'sent' | 'delivered' | 'read';
  text: string;
  isImage?: boolean;
  imageData?: string;
  error?: string;
  // Raw envelope inspector
  rawCiphertext?: string;
  rawEncryptedKey?: string;
  rawIv?: string;
  rawAuthTag?: string;
}

export interface ActiveSession {
  token: string;
  user: User;
  keyPair: CryptoKeyPair;
}
