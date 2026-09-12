package com.simplee2ee.chat.data.local

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.simplee2ee.chat.crypto.CryptoManager
import com.simplee2ee.chat.data.model.ConversationSummary
import com.simplee2ee.chat.data.model.DecryptedMessage
import com.simplee2ee.chat.data.model.User
import org.json.JSONObject

class ChatDatabaseHelper(
    context: Context,
    private val cryptoManager: CryptoManager
) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE $TABLE_MESSAGES (
                $COL_MESSAGE_ID TEXT PRIMARY KEY,
                $COL_PEER_ID TEXT NOT NULL,
                $COL_PEER_NAME TEXT NOT NULL,
                $COL_SENDER_ID TEXT NOT NULL,
                $COL_CREATED_AT INTEGER NOT NULL,
                $COL_PAYLOAD_CIPHER TEXT NOT NULL,
                $COL_IV TEXT NOT NULL,
                $COL_STATUS TEXT NOT NULL,
                $COL_IS_IMAGE INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_local_peer ON $TABLE_MESSAGES ($COL_PEER_ID)")
        db.execSQL("CREATE INDEX idx_local_created ON $TABLE_MESSAGES ($COL_CREATED_AT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_MESSAGES")
        onCreate(db)
    }

    /**
     * Inserts or updates a decrypted message into local encrypted storage.
     */
    fun saveMessage(
        messageId: String,
        peerId: String,
        peerName: String,
        senderId: String,
        createdAt: Long,
        payloadJson: String,
        status: String,
        isImage: Boolean = false
    ) {
        // Encrypt message payload at rest using Android Keystore AES-GCM
        val encResult = cryptoManager.encryptForLocalStorage(payloadJson)

        val values = ContentValues().apply {
            put(COL_MESSAGE_ID, messageId)
            put(COL_PEER_ID, peerId)
            put(COL_PEER_NAME, peerName)
            put(COL_SENDER_ID, senderId)
            put(COL_CREATED_AT, createdAt)
            put(COL_PAYLOAD_CIPHER, encResult.ciphertext)
            put(COL_IV, encResult.iv)
            put(COL_STATUS, status)
            put(COL_IS_IMAGE, if (isImage) 1 else 0)
        }

        writableDatabase.insertWithOnConflict(
            TABLE_MESSAGES,
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    /**
     * Updates message receipt status (sent -> delivered -> read)
     */
    fun updateMessageStatus(messageId: String, status: String) {
        val values = ContentValues().apply {
            put(COL_STATUS, status)
        }
        writableDatabase.update(
            TABLE_MESSAGES,
            values,
            "$COL_MESSAGE_ID = ?",
            arrayOf(messageId)
        )
    }

    /**
     * Retrieves all decrypted messages for a conversation with peer.
     */
    fun getMessagesForPeer(peerId: String): List<DecryptedMessage> {
        val list = mutableListOf<DecryptedMessage>()
        val cursor = readableDatabase.query(
            TABLE_MESSAGES,
            null,
            "$COL_PEER_ID = ?",
            arrayOf(peerId),
            null,
            null,
            "$COL_CREATED_AT ASC"
        )

        cursor.use {
            val idIndex = it.getColumnIndexOrThrow(COL_MESSAGE_ID)
            val peerIdIndex = it.getColumnIndexOrThrow(COL_PEER_ID)
            val peerNameIndex = it.getColumnIndexOrThrow(COL_PEER_NAME)
            val senderIdIndex = it.getColumnIndexOrThrow(COL_SENDER_ID)
            val createdAtIndex = it.getColumnIndexOrThrow(COL_CREATED_AT)
            val cipherIndex = it.getColumnIndexOrThrow(COL_PAYLOAD_CIPHER)
            val ivIndex = it.getColumnIndexOrThrow(COL_IV)
            val statusIndex = it.getColumnIndexOrThrow(COL_STATUS)
            val isImageIndex = it.getColumnIndexOrThrow(COL_IS_IMAGE)

            while (it.moveToNext()) {
                val messageId = it.getString(idIndex)
                val pId = it.getString(peerIdIndex)
                val pName = it.getString(peerNameIndex)
                val sId = it.getString(senderIdIndex)
                val time = it.getLong(createdAtIndex)
                val cipher = it.getString(cipherIndex)
                val iv = it.getString(ivIndex)
                val status = it.getString(statusIndex)
                val isImage = it.getInt(isImageIndex) == 1

                try {
                    val decryptedJson = cryptoManager.decryptFromLocalStorage(cipher, iv)
                    var text = decryptedJson
                    var imageBase64: String? = null

                    if (isImage) {
                        try {
                            val obj = JSONObject(decryptedJson)
                            text = "[Photo]"
                            imageBase64 = obj.optString("data", null)
                        } catch (e: Exception) {
                            text = "[Image]"
                        }
                    }

                    list.add(
                        DecryptedMessage(
                            id = messageId,
                            peerId = pId,
                            peerName = pName,
                            senderId = sId,
                            createdAt = time,
                            text = text,
                            isImage = isImage,
                            imageBase64 = imageBase64,
                            status = status
                        )
                    )
                } catch (e: Exception) {
                    list.add(
                        DecryptedMessage(
                            id = messageId,
                            peerId = pId,
                            peerName = pName,
                            senderId = sId,
                            createdAt = time,
                            text = "Unable to decrypt stored message.",
                            isImage = false,
                            status = status
                        )
                    )
                }
            }
        }
        return list
    }

    /**
     * Checks if a message already exists in local storage.
     */
    fun hasMessage(messageId: String): Boolean {
        val cursor = readableDatabase.query(
            TABLE_MESSAGES,
            arrayOf(COL_MESSAGE_ID),
            "$COL_MESSAGE_ID = ?",
            arrayOf(messageId),
            null,
            null,
            null
        )
        return cursor.use { it.count > 0 }
    }

    /**
     * Deletes local message history for a peer (Requirement 21).
     */
    fun deleteConversation(peerId: String): Int {
        return writableDatabase.delete(
            TABLE_MESSAGES,
            "$COL_PEER_ID = ?",
            arrayOf(peerId)
        )
    }

    /**
     * Returns recent conversation summaries.
     */
    fun getRecentConversations(): List<ConversationSummary> {
        val map = mutableMapOf<String, ConversationSummary>()
        val cursor = readableDatabase.rawQuery(
            """
            SELECT $COL_PEER_ID, $COL_PEER_NAME, $COL_PAYLOAD_CIPHER, $COL_IV, $COL_CREATED_AT, $COL_STATUS, $COL_IS_IMAGE
            FROM $TABLE_MESSAGES
            ORDER BY $COL_CREATED_AT DESC
            """.trimIndent(),
            null
        )

        cursor.use {
            val peerIdIndex = it.getColumnIndexOrThrow(COL_PEER_ID)
            val peerNameIndex = it.getColumnIndexOrThrow(COL_PEER_NAME)
            val cipherIndex = it.getColumnIndexOrThrow(COL_PAYLOAD_CIPHER)
            val ivIndex = it.getColumnIndexOrThrow(COL_IV)
            val timeIndex = it.getColumnIndexOrThrow(COL_CREATED_AT)
            val statusIndex = it.getColumnIndexOrThrow(COL_STATUS)
            val isImgIndex = it.getColumnIndexOrThrow(COL_IS_IMAGE)

            while (it.moveToNext()) {
                val peerId = it.getString(peerIdIndex)
                if (!map.containsKey(peerId)) {
                    val peerName = it.getString(peerNameIndex)
                    val cipher = it.getString(cipherIndex)
                    val iv = it.getString(ivIndex)
                    val time = it.getLong(timeIndex)
                    val status = it.getString(statusIndex)
                    val isImg = it.getInt(isImgIndex) == 1

                    var preview = "Message"
                    try {
                        val dec = cryptoManager.decryptFromLocalStorage(cipher, iv)
                        preview = if (isImg) "📷 Photo" else dec
                    } catch (e: Exception) {
                        preview = "[Encrypted Message]"
                    }

                    map[peerId] = ConversationSummary(
                        peer = User(id = peerId, username = peerName, displayName = peerName, publicKey = ""),
                        lastMessageText = preview,
                        lastMessageTime = time,
                        unreadCount = 0,
                        status = status
                    )
                }
            }
        }
        return map.values.toList()
    }

    companion object {
        private const val DATABASE_NAME = "chat_local_encrypted.db"
        private const val DATABASE_VERSION = 1

        private const val TABLE_MESSAGES = "local_messages"
        private const val COL_MESSAGE_ID = "message_id"
        private const val COL_PEER_ID = "peer_id"
        private const val COL_PEER_NAME = "peer_name"
        private const val COL_SENDER_ID = "sender_id"
        private const val COL_CREATED_AT = "created_at"
        private const val COL_PAYLOAD_CIPHER = "payload_cipher"
        private const val COL_IV = "iv"
        private const val COL_STATUS = "status"
        private const val COL_IS_IMAGE = "is_image"
    }
}
