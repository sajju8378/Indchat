package com.simplee2ee.chat.ui.chat

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.simplee2ee.chat.ChatApplication
import com.simplee2ee.chat.R
import com.simplee2ee.chat.data.model.DecryptedMessage
import com.simplee2ee.chat.data.model.EncryptedEnvelope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.UUID

class ChatActivity : AppCompatActivity() {

    private lateinit var app: ChatApplication
    private lateinit var peerId: String
    private lateinit var peerName: String
    private lateinit var peerUsername: String
    private var peerPublicKey: String? = null

    private lateinit var btnChatBack: ImageButton
    private lateinit var tvPeerAvatar: TextView
    private lateinit var tvPeerDisplayName: TextView
    private lateinit var tvPeerUsername: TextView
    private lateinit var btnChatMenu: ImageButton
    private lateinit var rvMessages: RecyclerView
    private lateinit var btnAttachFile: ImageButton
    private lateinit var etMessageInput: EditText
    private lateinit var btnCamera: ImageButton
    private lateinit var btnSend: FloatingActionButton

    private lateinit var adapter: MessageAdapter
    private var pollingJob: Job? = null

    // Gallery Picker Contract
    private val pickImageLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val imageUri: Uri? = result.data?.data
            if (imageUri != null) {
                processAndSendImage(imageUri)
            }
        }
    }

    // Camera Capture Contract
    private val takePhotoLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val bitmap = result.data?.extras?.get("data") as? Bitmap
            if (bitmap != null) {
                processAndSendBitmap(bitmap)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat)

        app = application as ChatApplication

        peerId = intent.getStringExtra(EXTRA_PEER_ID) ?: ""
        peerName = intent.getStringExtra(EXTRA_PEER_NAME) ?: ""
        peerUsername = intent.getStringExtra(EXTRA_PEER_USERNAME) ?: ""
        peerPublicKey = intent.getStringExtra(EXTRA_PEER_PUBLIC_KEY)

        if (peerId.isEmpty()) {
            Toast.makeText(this, "Invalid conversation", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        btnChatBack = findViewById(R.id.btnChatBack)
        tvPeerAvatar = findViewById(R.id.tvPeerAvatar)
        tvPeerDisplayName = findViewById(R.id.tvPeerDisplayName)
        tvPeerUsername = findViewById(R.id.tvPeerUsername)
        btnChatMenu = findViewById(R.id.btnChatMenu)
        rvMessages = findViewById(R.id.rvMessages)
        btnAttachFile = findViewById(R.id.btnAttachFile)
        etMessageInput = findViewById(R.id.etMessageInput)
        btnCamera = findViewById(R.id.btnCamera)
        btnSend = findViewById(R.id.btnSend)

        val displayName = peerName.ifBlank { peerUsername }
        tvPeerDisplayName.text = displayName
        tvPeerUsername.text = "@$peerUsername"
        tvPeerAvatar.text = displayName.firstOrNull()?.uppercase() ?: "P"

        val currentUser = app.getSavedUser()
        val currentUserId = currentUser?.id ?: ""

        adapter = MessageAdapter(currentUserId) { msg ->
            showImageDialog(msg)
        }

        val layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        rvMessages.layoutManager = layoutManager
        rvMessages.adapter = adapter

        btnChatBack.setOnClickListener { finish() }

        btnChatMenu.setOnClickListener { view ->
            showChatMenu(view)
        }

        btnSend.setOnClickListener {
            val text = etMessageInput.text.toString().trim()
            if (text.isNotEmpty()) {
                sendTextMessage(text)
                etMessageInput.setText("")
            }
        }

        btnAttachFile.setOnClickListener {
            val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
            pickImageLauncher.launch(intent)
        }

        btnCamera.setOnClickListener {
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            takePhotoLauncher.launch(intent)
        }

        // Fetch peer public key if not passed
        if (peerPublicKey.isNullOrBlank()) {
            fetchPeerPublicKey()
        }

        // Load cached messages immediately
        loadLocalMessages()
    }

    override fun onResume() {
        super.onResume()
        startPolling()
    }

    override fun onPause() {
        super.onPause()
        stopPolling()
    }

    private fun loadLocalMessages() {
        val list = app.dbHelper.getMessagesForPeer(peerId)
        adapter.submitList(list)
        if (list.isNotEmpty()) {
            rvMessages.scrollToPosition(list.size - 1)
        }
    }

    private fun startPolling() {
        stopPolling()
        pollingJob = lifecycleScope.launch {
            while (isActive) {
                syncMessagesFromServer()
                delay(3000) // 3s polling interval
            }
        }
    }

    private fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    private suspend fun syncMessagesFromServer() {
        val currentUserId = app.getSavedUser()?.id ?: return
        val result = app.apiClient.getConversation(peerId)

        result.onSuccess { remoteMessages ->
            val unreadIds = mutableListOf<String>()
            val undeliveredIds = mutableListOf<String>()

            for (msg in remoteMessages) {
                // If message received and not yet in local DB
                if (!app.dbHelper.hasMessage(msg.id)) {
                    try {
                        // Decrypt using our local private key
                        val decryptedPlaintext = app.cryptoManager.decryptMessage(
                            encryptedKeyBase64 = msg.encryptedKey,
                            ciphertextBase64 = msg.ciphertext,
                            ivBase64 = msg.iv,
                            authTagBase64 = msg.authTag
                        )

                        var isImage = false
                        var storedPayload = decryptedPlaintext
                        try {
                            val json = JSONObject(decryptedPlaintext)
                            if (json.optString("type") == "image") {
                                isImage = true
                            }
                        } catch (e: Exception) {
                            isImage = false
                        }

                        app.dbHelper.saveMessage(
                            messageId = msg.id,
                            peerId = peerId,
                            peerName = peerName,
                            senderId = msg.senderId,
                            createdAt = msg.createdAt,
                            payloadJson = storedPayload,
                            status = "read", // When opened in active chat screen, marked read
                            isImage = isImage
                        )
                    } catch (e: Exception) {
                        // Inability to decrypt message (e.g. old key)
                        app.dbHelper.saveMessage(
                            messageId = msg.id,
                            peerId = peerId,
                            peerName = peerName,
                            senderId = msg.senderId,
                            createdAt = msg.createdAt,
                            payloadJson = "Encrypted message (key mismatch).",
                            status = msg.status,
                            isImage = false
                        )
                    }
                } else {
                    // Update delivery status for existing sent messages
                    app.dbHelper.updateMessageStatus(msg.id, msg.status)
                }

                // If message was sent to us and not read, collect for read receipt
                if (msg.recipientId == currentUserId) {
                    if (msg.status != "read") {
                        unreadIds.add(msg.id)
                    } else if (msg.status == "sent") {
                        undeliveredIds.add(msg.id)
                    }
                }
            }

            // Mark delivered and read on server
            if (unreadIds.isNotEmpty()) {
                app.apiClient.markRead(unreadIds)
            } else if (undeliveredIds.isNotEmpty()) {
                app.apiClient.markDelivered(undeliveredIds)
            }

            // Refresh UI
            loadLocalMessages()
        }
    }

    private fun sendTextMessage(text: String) {
        lifecycleScope.launch {
            val pubKey = getOrFetchPeerKey() ?: run {
                Toast.makeText(this@ChatActivity, "Recipient public key unavailable", Toast.LENGTH_SHORT).show()
                return@launch
            }

            val currentUserId = app.getSavedUser()?.id ?: return@launch
            val localId = "msg_${UUID.randomUUID()}"
            val now = System.currentTimeMillis()

            try {
                // 1. Encrypt text with peer's RSA public key + AES-256-GCM
                val encResult = app.cryptoManager.encryptMessage(text, pubKey)

                // 2. Save locally first
                app.dbHelper.saveMessage(
                    messageId = localId,
                    peerId = peerId,
                    peerName = peerName,
                    senderId = currentUserId,
                    createdAt = now,
                    payloadJson = text,
                    status = "sent",
                    isImage = false
                )
                loadLocalMessages()

                // 3. Transmit envelope to server
                val envelope = EncryptedEnvelope(
                    recipientId = peerId,
                    encryptedKey = encResult.encryptedKey,
                    ciphertext = encResult.ciphertext,
                    iv = encResult.iv,
                    authTag = encResult.authTag
                )

                val sendResult = app.apiClient.sendMessage(envelope)
                sendResult.onSuccess { remoteMsg ->
                    app.dbHelper.updateMessageStatus(localId, "sent")
                }.onFailure { err ->
                    Toast.makeText(this@ChatActivity, "Failed to send: ${err.message}", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@ChatActivity, "Encryption error: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun processAndSendImage(uri: Uri) {
        try {
            val inputStream: InputStream? = contentResolver.openInputStream(uri)
            val bitmap = BitmapFactory.decodeStream(inputStream)
            inputStream?.close()
            if (bitmap != null) {
                processAndSendBitmap(bitmap)
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to load image: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun processAndSendBitmap(sourceBitmap: Bitmap) {
        // Resize bitmap to prevent huge payload (max 800px dimension)
        val maxDim = 800
        val width = sourceBitmap.width
        val height = sourceBitmap.height
        val scaledBitmap = if (width > maxDim || height > maxDim) {
            val ratio = width.toFloat() / height.toFloat()
            val newWidth = if (width > height) maxDim else (maxDim * ratio).toInt()
            val newHeight = if (height > width) maxDim else (maxDim / ratio).toInt()
            Bitmap.createScaledBitmap(sourceBitmap, newWidth, newHeight, true)
        } else {
            sourceBitmap
        }

        val outputStream = ByteArrayOutputStream()
        scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 75, outputStream)
        val imageBytes = outputStream.toByteArray()
        val imageBase64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP)

        val imageJson = JSONObject().apply {
            put("type", "image")
            put("data", imageBase64)
        }.toString()

        lifecycleScope.launch {
            val pubKey = getOrFetchPeerKey() ?: return@launch
            val currentUserId = app.getSavedUser()?.id ?: return@launch
            val localId = "msg_${UUID.randomUUID()}"
            val now = System.currentTimeMillis()

            try {
                // Encrypt image end-to-end
                val encResult = app.cryptoManager.encryptMessage(imageJson, pubKey)

                // Save locally
                app.dbHelper.saveMessage(
                    messageId = localId,
                    peerId = peerId,
                    peerName = peerName,
                    senderId = currentUserId,
                    createdAt = now,
                    payloadJson = imageJson,
                    status = "sent",
                    isImage = true
                )
                loadLocalMessages()

                // Transmit envelope
                val envelope = EncryptedEnvelope(
                    recipientId = peerId,
                    encryptedKey = encResult.encryptedKey,
                    ciphertext = encResult.ciphertext,
                    iv = encResult.iv,
                    authTag = encResult.authTag
                )
                app.apiClient.sendMessage(envelope)
            } catch (e: Exception) {
                Toast.makeText(this@ChatActivity, "Image encryption error: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private suspend fun getOrFetchPeerKey(): String? {
        if (!peerPublicKey.isNullOrBlank()) return peerPublicKey
        val result = app.apiClient.getUser(peerId)
        result.onSuccess { user ->
            peerPublicKey = user.publicKey
        }
        return peerPublicKey
    }

    private fun fetchPeerPublicKey() {
        lifecycleScope.launch {
            val result = app.apiClient.getUser(peerId)
            result.onSuccess { user ->
                peerPublicKey = user.publicKey
            }
        }
    }

    private fun showChatMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        popup.menu.add(0, 1, 0, R.string.delete_chat)
        popup.menu.add(0, 2, 1, "Encryption Info")
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> {
                    // Confirm delete conversation
                    MaterialAlertDialogBuilder(this)
                        .setTitle(R.string.delete_chat)
                        .setMessage("Delete all local message history for this conversation?")
                        .setPositiveButton("Delete") { _, _ ->
                            app.dbHelper.deleteConversation(peerId)
                            loadLocalMessages()
                            Toast.makeText(this, "Chat history deleted", Toast.LENGTH_SHORT).show()
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                    true
                }
                2 -> {
                    MaterialAlertDialogBuilder(this)
                        .setTitle("End-to-End Encryption")
                        .setMessage("Messages with $peerName are protected using RSA-2048-OAEP and AES-256-GCM. The server never has access to plaintext keys or messages.")
                        .setPositiveButton("OK", null)
                        .show()
                    true
                }
                else -> false
            }
        }
        popup.show()
    }

    private fun showImageDialog(message: DecryptedMessage) {
        if (message.imageBase64.isNullOrEmpty()) return
        val bytes = Base64.decode(message.imageBase64, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

        val imageView = android.widget.ImageView(this).apply {
            setImageBitmap(bitmap)
            adjustViewBounds = true
            setPadding(16, 16, 16, 16)
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Photo Attachment")
            .setView(imageView)
            .setPositiveButton("Close", null)
            .show()
    }

    companion object {
        const val EXTRA_PEER_ID = "extra_peer_id"
        const val EXTRA_PEER_NAME = "extra_peer_name"
        const val EXTRA_PEER_USERNAME = "extra_peer_username"
        const val EXTRA_PEER_PUBLIC_KEY = "extra_peer_public_key"
    }
}
