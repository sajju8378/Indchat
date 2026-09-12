package com.simplee2ee.chat.data.model

data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val publicKey: String,
    val keyBackup: String? = null
)

data class EncryptedEnvelope(
    val recipientId: String,
    val encryptedKey: String,
    val ciphertext: String,
    val iv: String,
    val authTag: String
)

data class ChatMessage(
    val id: String,
    val senderId: String,
    val recipientId: String,
    val ciphertext: String,
    val encryptedKey: String,
    val iv: String,
    val authTag: String,
    val createdAt: Long,
    val deliveredAt: Long? = null,
    val readAt: Long? = null,
    val status: String = "sent" // "sent", "delivered", "read"
)

data class DecryptedMessage(
    val id: String,
    val peerId: String,
    val peerName: String,
    val senderId: String,
    val createdAt: Long,
    val text: String,
    val isImage: Boolean = false,
    val imageBase64: String? = null,
    val status: String = "sent"
)

data class ConversationSummary(
    val peer: User,
    val lastMessageText: String,
    val lastMessageTime: Long,
    val unreadCount: Int,
    val status: String
)
