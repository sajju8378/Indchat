package com.simplee2ee.chat.data.remote

import com.simplee2ee.chat.data.model.ChatMessage
import com.simplee2ee.chat.data.model.EncryptedEnvelope
import com.simplee2ee.chat.data.model.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Direct Turso Cloud Database API Client.
 *
 * Connects directly to the hosted Turso cloud database over secure HTTPS.
 * Eliminates intermediate servers, local IP addresses, emulator ports, and same-network requirements.
 * Works seamlessly on any mobile network (4G/5G) or Wi-Fi globally, just like WhatsApp and Telegram.
 */
class ApiClient(var baseUrl: String = DEFAULT_TURSO_PIPELINE_URL) {

    var authToken: String? = null
    var currentUserId: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    companion object {
        const val DEFAULT_TURSO_DATABASE_URL = "libsql://indchat-sajju8378.aws-ap-south-1.turso.io"
        const val DEFAULT_TURSO_PIPELINE_URL = "https://indchat-sajju8378.aws-ap-south-1.turso.io/v2/pipeline"
        const val DEFAULT_TURSO_AUTH_TOKEN =
            "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODkzODY3NjksImlkIjoiMDFhMDlmYzItYzAwMS03YWU5LWIzYTMtOTJkZWU4ZTNmNmYzIiwia2lkIjoiM3RGRkE2bzVtUFVza01KdXhINmRyck1vSm50djREWHhtUWhVTXpkcy1CcyIsInJpZCI6ImJhNTVkYTY0LTkxMzktNGQyYS1iZWQ1LTNlZmZkNjZhMWU0YyJ9.oRjFkaqbJBae1-QGSvjysBgBkJ5AAO0mQtbCyfcpXjd-5e-HuobNIvrvtqV6-n_hJDza9RT0BKTE-yx5e6T1BQ"
    }

    private fun sha256(input: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = md.digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /**
     * Executes parameterized SQL directly on Turso DB via the v2 pipeline API.
     */
    private fun executeTursoSql(sql: String, args: List<Any?> = emptyList()): List<Map<String, Any?>> {
        val pipelineUrl = if (baseUrl.contains("turso.io")) {
            if (baseUrl.endsWith("/v2/pipeline")) baseUrl else "${baseUrl.removeSuffix("/")}/v2/pipeline"
        } else {
            DEFAULT_TURSO_PIPELINE_URL
        }

        val requestObj = JSONObject().apply {
            put("type", "execute")
            val stmt = JSONObject().apply {
                put("sql", sql)
                val argsArray = JSONArray()
                for (arg in args) {
                    val cell = JSONObject()
                    when (arg) {
                        null -> {
                            cell.put("type", "null")
                        }
                        is Number -> {
                            cell.put("type", "integer")
                            cell.put("value", arg.toString())
                        }
                        else -> {
                            cell.put("type", "text")
                            cell.put("value", arg.toString())
                        }
                    }
                    argsArray.put(cell)
                }
                put("args", argsArray)
            }
            put("stmt", stmt)
        }

        val rootJson = JSONObject().apply {
            put("requests", JSONArray().put(requestObj))
        }

        val request = Request.Builder()
            .url(pipelineUrl)
            .addHeader("Authorization", "Bearer $DEFAULT_TURSO_AUTH_TOKEN")
            .addHeader("Content-Type", "application/json")
            .post(rootJson.toString().toRequestBody(jsonMediaType))
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: ""

        if (!response.isSuccessful) {
            val errMessage = try {
                val errObj = JSONObject(body)
                errObj.optString("error", "Database error (HTTP ${response.code})")
            } catch (e: Exception) {
                "Database error (HTTP ${response.code})"
            }
            throw IOException(errMessage)
        }

        val resObj = JSONObject(body)
        val resultsArray = resObj.optJSONArray("results")
            ?: throw IOException("Invalid database response format.")

        if (resultsArray.length() == 0) return emptyList()

        val firstResult = resultsArray.getJSONObject(0)
        val resultType = firstResult.optString("type")

        if (resultType == "error") {
            val errObj = firstResult.optJSONObject("error")
            val rawMsg = errObj?.optString("message") ?: "Database query failed."
            if (rawMsg.contains("UNIQUE constraint failed: users.username", ignoreCase = true)) {
                throw IOException("This username is already taken. Please choose another username.")
            }
            throw IOException(rawMsg)
        }

        val responseData = firstResult.optJSONObject("response") ?: return emptyList()
        val execResult = responseData.optJSONObject("result") ?: return emptyList()
        val colsArray = execResult.optJSONArray("cols") ?: return emptyList()
        val rowsArray = execResult.optJSONArray("rows") ?: return emptyList()

        val colNames = mutableListOf<String>()
        for (i in 0 until colsArray.length()) {
            colNames.add(colsArray.getJSONObject(i).getString("name"))
        }

        val list = mutableListOf<Map<String, Any?>>()
        for (r in 0 until rowsArray.length()) {
            val rowCells = rowsArray.getJSONArray(r)
            val rowMap = mutableMapOf<String, Any?>()
            for (c in 0 until rowCells.length()) {
                val cell = rowCells.getJSONObject(c)
                val type = cell.optString("type")
                val colName = colNames[c]
                when (type) {
                    "null" -> rowMap[colName] = null
                    "integer" -> rowMap[colName] = cell.optString("value").toLongOrNull() ?: 0L
                    else -> rowMap[colName] = cell.optString("value")
                }
            }
            list.add(rowMap)
        }
        return list
    }

    private fun verifyPasswordMatch(candidate: String, storedHash: String?): Boolean {
        if (storedHash.isNullOrBlank()) return false
        val hashedCandidate = sha256(candidate)
        if (storedHash.equals(hashedCandidate, ignoreCase = true)) return true
        if (storedHash.equals(candidate)) return true
        if (storedHash.equals(sha256(candidate.trim()), ignoreCase = true)) return true
        return false
    }

    /**
     * Registers a new user directly in Turso cloud database.
     */
    suspend fun register(
        username: String,
        displayName: String,
        password: String,
        publicKey: String,
        keyBackup: String?
    ): Result<Pair<String, User>> = withContext(Dispatchers.IO) {
        try {
            val cleanUsername = username.trim()
            val cleanDisplay = displayName.trim().ifBlank { cleanUsername }

            // 1. Check if user exists
            val existing = executeTursoSql(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                listOf(cleanUsername)
            )
            if (existing.isNotEmpty()) {
                return@withContext Result.failure(IOException("Username '@$cleanUsername' is already taken. Please choose another."))
            }

            // 2. Insert new user into Turso DB
            val userId = "E2E-" + UUID.randomUUID().toString().substring(0, 8).uppercase()
            val passHash = sha256(password)
            val now = System.currentTimeMillis()

            executeTursoSql(
                "INSERT INTO users (id, username, display_name, password_hash, public_key, key_backup, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                listOf(userId, cleanUsername, cleanDisplay, passHash, publicKey, keyBackup, now, now)
            )

            // 3. Create session token
            val token = "turso_tok_${System.currentTimeMillis()}_${UUID.randomUUID().toString().substring(0, 8)}"
            val expiresAt = now + (30L * 24 * 60 * 60 * 1000)
            executeTursoSql(
                "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                listOf(token, userId, now, expiresAt)
            )

            authToken = token
            currentUserId = userId

            val user = User(
                id = userId,
                username = cleanUsername,
                displayName = cleanDisplay,
                publicKey = publicKey,
                keyBackup = keyBackup
            )
            Result.success(Pair(token, user))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Logs in an existing user using Turso cloud database.
     */
    suspend fun login(username: String, password: String): Result<Pair<String, User>> =
        withContext(Dispatchers.IO) {
            try {
                val cleanInput = username.trim()
                val rows = executeTursoSql(
                    "SELECT id, username, display_name, password_hash, public_key, key_backup FROM users WHERE username = ? COLLATE NOCASE OR id = ? LIMIT 1",
                    listOf(cleanInput, cleanInput)
                )

                if (rows.isEmpty()) {
                    return@withContext Result.failure(IOException("Account not found. Please check your username or register."))
                }

                val row = rows[0]
                val storedHash = row["password_hash"] as? String ?: ""
                if (!verifyPasswordMatch(password, storedHash)) {
                    return@withContext Result.failure(IOException("Incorrect password. Please try again."))
                }

                val userId = row["id"] as? String ?: ""
                val foundUsername = row["username"] as? String ?: cleanInput
                val foundDisplayName = row["display_name"] as? String ?: foundUsername
                val foundPublicKey = row["public_key"] as? String ?: ""
                val foundKeyBackup = row["key_backup"] as? String

                val now = System.currentTimeMillis()
                val token = "turso_tok_${System.currentTimeMillis()}_${UUID.randomUUID().toString().substring(0, 8)}"
                val expiresAt = now + (30L * 24 * 60 * 60 * 1000)

                executeTursoSql(
                    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    listOf(token, userId, now, expiresAt)
                )

                authToken = token
                currentUserId = userId

                val user = User(
                    id = userId,
                    username = foundUsername,
                    displayName = foundDisplayName,
                    publicKey = foundPublicKey,
                    keyBackup = foundKeyBackup
                )
                Result.success(Pair(token, user))
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun logout(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            authToken?.let { token ->
                executeTursoSql("DELETE FROM sessions WHERE token = ?", listOf(token))
            }
            authToken = null
            currentUserId = null
            Result.success(Unit)
        } catch (e: Exception) {
            authToken = null
            currentUserId = null
            Result.success(Unit)
        }
    }

    suspend fun searchUsers(query: String): Result<List<User>> = withContext(Dispatchers.IO) {
        try {
            val cleanQuery = query.trim()
            val rows = if (cleanQuery.isEmpty()) {
                executeTursoSql(
                    "SELECT id, username, display_name, public_key, key_backup FROM users ORDER BY created_at DESC LIMIT 30"
                )
            } else {
                val wildcard = "%$cleanQuery%"
                executeTursoSql(
                    "SELECT id, username, display_name, public_key, key_backup FROM users WHERE (username LIKE ? OR display_name LIKE ? OR id LIKE ?) LIMIT 50",
                    listOf(wildcard, wildcard, wildcard)
                )
            }

            val myId = currentUserId
            val list = mutableListOf<User>()
            for (row in rows) {
                val id = row["id"] as? String ?: continue
                if (id == myId) continue
                list.add(
                    User(
                        id = id,
                        username = row["username"] as? String ?: "",
                        displayName = row["display_name"] as? String ?: "",
                        publicKey = row["public_key"] as? String ?: "",
                        keyBackup = row["key_backup"] as? String
                    )
                )
            }
            Result.success(list)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getUser(idOrUsername: String): Result<User> = withContext(Dispatchers.IO) {
        try {
            val clean = idOrUsername.trim()
            val rows = executeTursoSql(
                "SELECT id, username, display_name, public_key, key_backup FROM users WHERE id = ? OR username = ? COLLATE NOCASE LIMIT 1",
                listOf(clean, clean)
            )
            if (rows.isEmpty()) {
                return@withContext Result.failure(IOException("User '$clean' not found."))
            }
            val row = rows[0]
            val user = User(
                id = row["id"] as? String ?: "",
                username = row["username"] as? String ?: "",
                displayName = row["display_name"] as? String ?: "",
                publicKey = row["public_key"] as? String ?: "",
                keyBackup = row["key_backup"] as? String
            )
            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun sendMessage(envelope: EncryptedEnvelope): Result<ChatMessage> =
        withContext(Dispatchers.IO) {
            try {
                val msgId = "msg-" + UUID.randomUUID().toString()
                val senderId = currentUserId ?: ""
                val now = System.currentTimeMillis()

                executeTursoSql(
                    "INSERT INTO messages (id, sender_id, recipient_id, ciphertext, encrypted_key, iv, auth_tag, created_at, delivered_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
                    listOf(
                        msgId,
                        senderId,
                        envelope.recipientId,
                        envelope.ciphertext,
                        envelope.encryptedKey,
                        envelope.iv,
                        envelope.authTag,
                        now
                    )
                )

                val msg = ChatMessage(
                    id = msgId,
                    senderId = senderId,
                    recipientId = envelope.recipientId,
                    ciphertext = envelope.ciphertext,
                    encryptedKey = envelope.encryptedKey,
                    iv = envelope.iv,
                    authTag = envelope.authTag,
                    createdAt = now,
                    status = "sent"
                )
                Result.success(msg)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun getConversation(peerId: String): Result<List<ChatMessage>> =
        withContext(Dispatchers.IO) {
            try {
                val myId = currentUserId ?: ""
                val rows = executeTursoSql(
                    "SELECT id, sender_id, recipient_id, ciphertext, encrypted_key, iv, auth_tag, created_at, delivered_at, read_at FROM messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) ORDER BY created_at ASC LIMIT 300",
                    listOf(myId, peerId, peerId, myId)
                )

                val list = mutableListOf<ChatMessage>()
                for (row in rows) {
                    val deliveredAt = (row["delivered_at"] as? Number)?.toLong()
                    val readAt = (row["read_at"] as? Number)?.toLong()
                    val status = when {
                        readAt != null && readAt > 0 -> "read"
                        deliveredAt != null && deliveredAt > 0 -> "delivered"
                        else -> "sent"
                    }

                    list.add(
                        ChatMessage(
                            id = row["id"] as? String ?: "",
                            senderId = row["sender_id"] as? String ?: "",
                            recipientId = row["recipient_id"] as? String ?: "",
                            ciphertext = row["ciphertext"] as? String ?: "",
                            encryptedKey = row["encrypted_key"] as? String ?: "",
                            iv = row["iv"] as? String ?: "",
                            authTag = row["auth_tag"] as? String ?: "",
                            createdAt = (row["created_at"] as? Number)?.toLong() ?: 0L,
                            deliveredAt = deliveredAt,
                            readAt = readAt,
                            status = status
                        )
                    )
                }
                Result.success(list)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun markDelivered(ids: List<String>): Result<Int> = withContext(Dispatchers.IO) {
        try {
            if (ids.isEmpty()) return@withContext Result.success(0)
            val myId = currentUserId ?: return@withContext Result.success(0)
            val now = System.currentTimeMillis()
            var count = 0
            for (id in ids) {
                executeTursoSql(
                    "UPDATE messages SET delivered_at = ? WHERE id = ? AND recipient_id = ? AND delivered_at IS NULL",
                    listOf(now, id, myId)
                )
                count++
            }
            Result.success(count)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun markRead(ids: List<String>): Result<Int> = withContext(Dispatchers.IO) {
        try {
            if (ids.isEmpty()) return@withContext Result.success(0)
            val myId = currentUserId ?: return@withContext Result.success(0)
            val now = System.currentTimeMillis()
            var count = 0
            for (id in ids) {
                executeTursoSql(
                    "UPDATE messages SET read_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND recipient_id = ? AND read_at IS NULL",
                    listOf(now, now, id, myId)
                )
                count++
            }
            Result.success(count)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun rotateKey(publicKey: String, keyBackup: String?): Result<User> = withContext(Dispatchers.IO) {
        try {
            val myId = currentUserId ?: throw IOException("User not authenticated.")
            val now = System.currentTimeMillis()
            executeTursoSql(
                "UPDATE users SET public_key = ?, key_backup = ?, updated_at = ? WHERE id = ?",
                listOf(publicKey, keyBackup, now, myId)
            )
            val user = getUser(myId).getOrThrow()
            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
