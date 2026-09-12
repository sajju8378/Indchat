package com.simplee2ee.chat.crypto

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

class CryptoManager(private val context: Context) {

    private val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    private val secureRandom = SecureRandom()

    init {
        ensureStorageMasterKey()
    }

    // ==========================================
    // 1. RSA KEYPAIR GENERATION & MANAGEMENT
    // ==========================================

    /**
     * Generates a 2048-bit RSA keypair in the Android Keystore.
     * Returns the Public Key formatted as an SPKI PEM string.
     */
    fun generateRsaKeyPair(): String {
        val keyPairGenerator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_RSA,
            ANDROID_KEYSTORE
        )

        val spec = KeyGenParameterSpec.Builder(
            RSA_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .build()

        keyPairGenerator.initialize(spec)
        val keyPair = keyPairGenerator.generateKeyPair()
        return formatPublicKeyPem(keyPair.public)
    }

    fun hasDeviceRsaKey(): Boolean {
        return keyStore.containsAlias(RSA_KEY_ALIAS)
    }

    fun getDevicePublicKeyPem(): String? {
        val cert = keyStore.getCertificate(RSA_KEY_ALIAS) ?: return null
        return formatPublicKeyPem(cert.publicKey)
    }

    private fun getDevicePrivateKey(): PrivateKey? {
        val entry = keyStore.getEntry(RSA_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        return entry?.privateKey
    }

    // ==========================================
    // 2. E2EE ENVELOPE ENCRYPTION & DECRYPTION
    // ==========================================

    data class EncryptedEnvelopeResult(
        val encryptedKey: String,
        val ciphertext: String,
        val iv: String,
        val authTag: String
    )

    /**
     * Encrypts plaintext payload using AES-256-GCM, and wraps AES key with recipient's RSA public key using RSA-OAEP SHA-256.
     */
    fun encryptMessage(plaintext: String, recipientPublicKeyPem: String): EncryptedEnvelopeResult {
        val recipientPublicKey = parsePublicKeyPem(recipientPublicKeyPem)

        // 1. Generate random AES-256 key (32 bytes) and fresh random IV (12 bytes)
        val aesKeyBytes = ByteArray(32)
        secureRandom.nextBytes(aesKeyBytes)
        val aesKey = SecretKeySpec(aesKeyBytes, "AES")

        val ivBytes = ByteArray(12)
        secureRandom.nextBytes(ivBytes)

        // 2. Encrypt plaintext with AES-256-GCM
        val aesCipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(128, ivBytes)
        aesCipher.init(Cipher.ENCRYPT_MODE, aesKey, gcmSpec)
        val cipherAndTag = aesCipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // In Java AES/GCM, cipherAndTag has the 16-byte authentication tag appended at the end
        val ciphertextLength = cipherAndTag.size - 16
        val ciphertextBytes = cipherAndTag.copyOfRange(0, ciphertextLength)
        val authTagBytes = cipherAndTag.copyOfRange(ciphertextLength, cipherAndTag.size)

        // 3. Encrypt AES key using recipient's RSA public key (RSA-OAEP SHA-256)
        val rsaCipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        val oaepParams = OAEPParameterSpec(
            "SHA-256",
            "MGF1",
            MGF1ParameterSpec.SHA256,
            PSource.PSpecified.DEFAULT
        )
        rsaCipher.init(Cipher.ENCRYPT_MODE, recipientPublicKey, oaepParams)
        val encryptedAesKey = rsaCipher.doFinal(aesKeyBytes)

        return EncryptedEnvelopeResult(
            encryptedKey = Base64.encodeToString(encryptedAesKey, Base64.NO_WRAP),
            ciphertext = Base64.encodeToString(ciphertextBytes, Base64.NO_WRAP),
            iv = Base64.encodeToString(ivBytes, Base64.NO_WRAP),
            authTag = Base64.encodeToString(authTagBytes, Base64.NO_WRAP)
        )
    }

    /**
     * Decrypts an incoming message envelope using local private key and AES-GCM.
     */
    fun decryptMessage(
        encryptedKeyBase64: String,
        ciphertextBase64: String,
        ivBase64: String,
        authTagBase64: String,
        fallbackPrivateKey: PrivateKey? = null
    ): String {
        val privateKey = fallbackPrivateKey ?: getDevicePrivateKey()
            ?: throw IllegalStateException("No device private key available for decryption")

        // 1. Unwrap AES key using RSA-OAEP with SHA-256
        val encryptedKeyBytes = Base64.decode(encryptedKeyBase64, Base64.DEFAULT)
        val rsaCipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        val oaepParams = OAEPParameterSpec(
            "SHA-256",
            "MGF1",
            MGF1ParameterSpec.SHA256,
            PSource.PSpecified.DEFAULT
        )
        rsaCipher.init(Cipher.DECRYPT_MODE, privateKey, oaepParams)
        val aesKeyBytes = rsaCipher.doFinal(encryptedKeyBytes)
        val aesKey = SecretKeySpec(aesKeyBytes, "AES")

        // 2. Recombine ciphertext and auth tag for Java GCM
        val ciphertextBytes = Base64.decode(ciphertextBase64, Base64.DEFAULT)
        val authTagBytes = Base64.decode(authTagBase64, Base64.DEFAULT)
        val combinedCipher = ByteArray(ciphertextBytes.size + authTagBytes.size)
        System.arraycopy(ciphertextBytes, 0, combinedCipher, 0, ciphertextBytes.size)
        System.arraycopy(authTagBytes, 0, combinedCipher, ciphertextBytes.size, authTagBytes.size)

        // 3. Decrypt with AES-GCM
        val ivBytes = Base64.decode(ivBase64, Base64.DEFAULT)
        val aesCipher = Cipher.getInstance("AES/GCM/NoPadding")
        val gcmSpec = GCMParameterSpec(128, ivBytes)
        aesCipher.init(Cipher.DECRYPT_MODE, aesKey, gcmSpec)
        val decryptedBytes = aesCipher.doFinal(combinedCipher)

        return String(decryptedBytes, Charsets.UTF_8)
    }

    // ==========================================
    // 3. ENCRYPTED PRIVATE-KEY RECOVERY BACKUP
    // ==========================================

    /**
     * Derives a key from the user's password and encrypts the private key for recovery backup.
     */
    fun createEncryptedKeyBackup(privateKey: PrivateKey, password: String): String {
        val salt = ByteArray(16).apply { secureRandom.nextBytes(this) }
        val derivedKey = deriveKeyFromPassword(password, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, derivedKey) // Keystore / system generates random IV
        val iv = cipher.iv

        val pkcs8Bytes = privateKey.encoded
        val cipherAndTag = cipher.doFinal(pkcs8Bytes)

        val tagLength = 16
        val ciphertextLength = cipherAndTag.size - tagLength
        val ciphertext = cipherAndTag.copyOfRange(0, ciphertextLength)
        val tag = cipherAndTag.copyOfRange(ciphertextLength, cipherAndTag.size)

        val json = JSONObject().apply {
            put("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
            put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            put("tag", Base64.encodeToString(tag, Base64.NO_WRAP))
            put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        }
        return json.toString()
    }

    /**
     * Recovers a private key from an encrypted backup using the user's password.
     */
    fun recoverPrivateKeyFromBackup(backupJson: String, password: String): PrivateKey {
        val json = JSONObject(backupJson)
        val salt = Base64.decode(json.getString("salt"), Base64.DEFAULT)
        val iv = Base64.decode(json.getString("iv"), Base64.DEFAULT)
        val tag = Base64.decode(json.getString("tag"), Base64.DEFAULT)
        val ciphertext = Base64.decode(json.getString("ciphertext"), Base64.DEFAULT)

        val derivedKey = deriveKeyFromPassword(password, salt)

        val combinedCipher = ByteArray(ciphertext.size + tag.size)
        System.arraycopy(ciphertext, 0, combinedCipher, 0, ciphertext.size)
        System.arraycopy(tag, 0, combinedCipher, ciphertext.size, tag.size)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, derivedKey, GCMParameterSpec(128, iv))
        val pkcs8Bytes = cipher.doFinal(combinedCipher)

        val keyFactory = KeyFactory.getInstance("RSA")
        return keyFactory.generatePrivate(PKCS8EncodedKeySpec(pkcs8Bytes))
    }

    private fun deriveKeyFromPassword(password: String, salt: ByteArray): SecretKey {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(password.toCharArray(), salt, 100000, 256)
        val tmp = factory.generateSecret(spec)
        return SecretKeySpec(tmp.encoded, "AES")
    }

    // ==========================================
    // 4. LOCAL ENCRYPTION AT REST (KEYSTORE)
    // ==========================================

    private fun ensureStorageMasterKey() {
        if (!keyStore.containsAlias(STORAGE_MASTER_KEY_ALIAS)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE
            )
            val spec = KeyGenParameterSpec.Builder(
                STORAGE_MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()

            keyGenerator.init(spec)
            keyGenerator.generateKey()
        }
    }

    private fun getStorageMasterKey(): SecretKey {
        return keyStore.getKey(STORAGE_MASTER_KEY_ALIAS, null) as SecretKey
    }

    data class LocalStorageCipherResult(
        val ciphertext: String,
        val iv: String
    )

    /**
     * Encrypts local chat data at rest using Android Keystore AES-GCM.
     * Note: Does NOT use a caller-supplied IV.
     * System / Keystore generates the fresh IV upon cipher.init(ENCRYPT_MODE, secretKey).
     */
    fun encryptForLocalStorage(plaintext: String): LocalStorageCipherResult {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getStorageMasterKey()) // System generates IV
        val iv = cipher.iv

        val cipherBytes = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return LocalStorageCipherResult(
            ciphertext = Base64.encodeToString(cipherBytes, Base64.NO_WRAP),
            iv = Base64.encodeToString(iv, Base64.NO_WRAP)
        )
    }

    /**
     * Decrypts local chat data at rest using Android Keystore AES-GCM and stored IV.
     */
    fun decryptFromLocalStorage(ciphertextBase64: String, ivBase64: String): String {
        val iv = Base64.decode(ivBase64, Base64.DEFAULT)
        val ciphertext = Base64.decode(ciphertextBase64, Base64.DEFAULT)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getStorageMasterKey(), GCMParameterSpec(128, iv))
        val decryptedBytes = cipher.doFinal(ciphertext)
        return String(decryptedBytes, Charsets.UTF_8)
    }

    // ==========================================
    // 5. HELPER FORMATTERS
    // ==========================================

    fun formatPublicKeyPem(publicKey: PublicKey): String {
        val base64 = Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
        return "-----BEGIN PUBLIC KEY-----\n$base64\n-----END PUBLIC KEY-----"
    }

    fun parsePublicKeyPem(pem: String): PublicKey {
        val cleanPem = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace("\\s".toRegex(), "")
        val keyBytes = Base64.decode(cleanPem, Base64.DEFAULT)
        val spec = X509EncodedKeySpec(keyBytes)
        val keyFactory = KeyFactory.getInstance("RSA")
        return keyFactory.generatePublic(spec)
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val RSA_KEY_ALIAS = "SimpleE2EE_RSA_Key"
        private const val STORAGE_MASTER_KEY_ALIAS = "SimpleE2EE_Storage_MasterKey"
    }
}
