# Indchat

A complete, production-ready, zero-knowledge End-to-End Encrypted (E2EE) messaging application with a Progressive Web App (PWA), native Android client (Kotlin, Android Keystore, SQLite encrypted at rest), and a hardened Node.js 22 backend.

---

## Security Architecture

Indchat implements standard cryptographic algorithms without proprietary or untested schemes:
- **Asymmetric Key Exchange**: RSA 2048-bit key pairs generated on the client device.
- **Key Encapsulation**: RSA-OAEP with SHA-256 and MGF1 for securely wrapping per-message session keys.
- **Symmetric Message Encryption**: AES-256-GCM with a fresh, cryptographically secure 12-byte IV and 128-bit authentication tag generated for every single message.
- **Zero-Knowledge Server**: The server only receives and stores encrypted envelopes (`ciphertext`, `encryptedKey`, `iv`, `authTag`). Plaintext messages and private keys are never transmitted to or accessible by the server.
- **Android Keystore Protection**: Private keys are held in hardware-backed Android Keystore storage.
- **Encrypted Local Storage**: Local chat history on Android is encrypted at rest using Android Keystore AES-GCM with system-generated IVs.
- **Password-Derived Key Recovery**: Accounts support optional encrypted key backups derived with PBKDF2-HMAC-SHA256 (100,000 rounds).

---

## Features

1. **User Identity & Registration**:
   - Unique usernames and auto-generated internal UUID identifiers (`E2E-XXXXXX`).
   - Strong password hashing with scrypt.
   - Client-side RSA 2048-bit keypair generation.
2. **User Search & Discovery**:
   - Case-insensitive search by username, display name, or user ID.
   - Public key lookup for initiating conversations.
3. **End-to-End Encrypted Messaging**:
   - Instant message encryption with recipient's public key.
   - Instant decryption upon arrival using recipient's private key.
4. **Three-State Delivery Receipts**:
   - **Sent** (`✓` single tick)
   - **Delivered** (`✓✓` double grey tick)
   - **Read** (`✓✓` double blue/cyan tick)
5. **Photo & File Attachments**:
   - Encrypted photo transfer with client-side image downsampling.
   - Inline photo rendering in chat bubbles with zoom and save options.
6. **Encrypted Offline History**:
   - Encrypted local SQLite persistence that survives app and activity restarts.
   - Automatic background syncing upon network availability.
7. **Production CI/CD & Cloud Deployment**:
   - GitHub Actions workflow (`.github/workflows/ci.yml`) for automated backend testing and APK builds.
   - Render production blueprint (`render.yaml`).

---

## Project Structure

```
├── android/                             # Native Android Studio Project (Kotlin)
│   ├── app/
│   │   ├── build.gradle.kts
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/com/simplee2ee/chat/
│   │       │   ├── ChatApplication.kt
│   │       │   ├── crypto/CryptoManager.kt       # Keystore & RSA-OAEP/AES-GCM
│   │       │   ├── data/
│   │       │   │   ├── local/ChatDatabaseHelper.kt # Encrypted SQLite at rest
│   │       │   │   ├── model/Models.kt
│   │       │   │   └── remote/ApiClient.kt        # OkHttp client & Coroutines
│   │       │   └── ui/
│   │       │       ├── auth/                      # Splash, Login, Register
│   │       │       ├── chat/                      # Chat screen, MessageAdapter
│   │       │       ├── main/                      # Recent chats
│   │       │       ├── recovery/                  # Key recovery dialog
│   │       │       └── search/                    # User search
│   │       └── res/                               # Layouts, themes, drawables
│   ├── build.gradle.kts
│   └── settings.gradle.kts
├── server/                              # Hardened Backend (Node.js 22)
│   ├── src/
│   │   ├── api.js                       # REST endpoints
│   │   ├── auth.js                      # Bearer token middleware
│   │   ├── crypto.js                    # Password hashing & scrypt
│   │   ├── database.js                  # SQLite database layer
│   │   └── server.js                    # Express app configuration
│   └── tests/
│       └── e2ee_integration.test.js     # 22 automated integration tests
├── src/                                 # Web Companion & Live Test Console
│   ├── components/
│   ├── crypto/webCrypto.ts              # Web Crypto API RSA/AES engine
│   └── App.tsx
├── .github/workflows/ci.yml             # GitHub Actions CI/CD pipeline
├── render.yaml                          # Render Cloud Deployment
└── package.json
```

---

## Running the Automated Test Suite

The test suite validates the entire E2EE messaging lifecycle across 22 tests:

```bash
npm test
```

### Verified Test Cases:
1. Alice registration with RSA public key
2. Bob registration with RSA public key
3. Alice login and token issuance
4. Bob login and token issuance
5. User directory search
6. Public key retrieval
7. RSA-OAEP and AES-256-GCM envelope encryption
8. Message dispatch Alice -> Bob
9. Server zero-knowledge verification (server cannot decrypt ciphertext)
10. Bob message retrieval
11. Bob message decryption
12. Delivery receipt dispatch
13. Double grey tick (`delivered`) status verification
14. Read receipt dispatch
15. Double blue tick (`read`) status verification
16. Encrypted reply Bob -> Alice
17. Reply decryption by Alice
18. Duplicate username rejection
19. Password authentication rejection
20. Expired/invalid token rejection
21. End-to-end encrypted photo attachment test
22. Database persistence across server restarts

---

## Building the Android Application

To build the debug APK using the Gradle wrapper:

```bash
cd android
./gradlew assembleDebug
```

The compiled APK will be generated at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Android Emulator Configuration
When testing inside the standard Android Emulator, the app connects to your local development backend using:
```
http://10.0.2.2:3000
```

---

## Production Deployment (Render)

1. Connect your repository to [Render](https://render.com).
2. Create a new **Blueprint Instance** and select this repository.
3. Render reads `render.yaml`, provisions a Node.js 22 web service, and launches `npm start`.
