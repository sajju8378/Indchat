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
import java.util.concurrent.TimeUnit

class ApiClient(var baseUrl: String) {

    var authToken: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private fun newRequestBuilder(path: String): Request.Builder {
        var base = baseUrl.trim().removeSuffix("/")
        if (!base.startsWith("http://", ignoreCase = true) && !base.startsWith("https://", ignoreCase = true)) {
            base = "http://$base"
        }
        val cleanPath = path.removePrefix("/")
        val url = "$base/$cleanPath"
        val builder = Request.Builder().url(url)
        authToken?.let {
            builder.addHeader("Authorization", "Bearer $it")
        }
        return builder
    }

    suspend fun register(
        username: String,
        displayName: String,
        password: String,
        publicKey: String,
        keyBackup: String?
    ): Result<Pair<String, User>> = withContext(Dispatchers.IO) {
        try {
            val json = JSONObject().apply {
                put("username", username)
                put("displayName", displayName)
                put("password", password)
                put("publicKey", publicKey)
                keyBackup?.let { put("keyBackup", it) }
            }

            val request = newRequestBuilder("v1/auth/register")
                .post(json.toString().toRequestBody(jsonMediaType))
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val errorMsg = try {
                    JSONObject(body).optString("error", "Registration failed with status ${response.code}")
                } catch (e: Exception) {
                    "Registration failed: ${response.message}"
                }
                return@withContext Result.failure(IOException(errorMsg))
            }

            val resObj = JSONObject(body)
            val token = resObj.getString("token")
            val userObj = resObj.getJSONObject("user")
            val user = User(
                id = userObj.getString("id"),
                username = userObj.getString("username"),
                displayName = userObj.getString("displayName"),
                publicKey = userObj.getString("publicKey"),
                keyBackup = userObj.optString("keyBackup", null)
            )
            Result.success(Pair(token, user))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun login(username: String, password: String): Result<Pair<String, User>> =
        withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("username", username)
                    put("password", password)
                }

                val request = newRequestBuilder("v1/auth/login")
                    .post(json.toString().toRequestBody(jsonMediaType))
                    .build()

                val response = client.newCall(request).execute()
                val body = response.body?.string() ?: ""

                if (!response.isSuccessful) {
                    val errorMsg = try {
                        JSONObject(body).optString("error", "Incorrect username or password.")
                    } catch (e: Exception) {
                        "Login failed: ${response.message}"
                    }
                    return@withContext Result.failure(IOException(errorMsg))
                }

                val resObj = JSONObject(body)
                val token = resObj.getString("token")
                val userObj = resObj.getJSONObject("user")
                val user = User(
                    id = userObj.getString("id"),
                    username = userObj.getString("username"),
                    displayName = userObj.getString("displayName"),
                    publicKey = userObj.getString("publicKey"),
                    keyBackup = userObj.optString("keyBackup", null)
                )
                Result.success(Pair(token, user))
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun logout(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val request = newRequestBuilder("v1/auth/logout")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            client.newCall(request).execute()
            authToken = null
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun searchUsers(query: String): Result<List<User>> = withContext(Dispatchers.IO) {
        try {
            val request = newRequestBuilder("v1/users/search?q=${java.net.URLEncoder.encode(query, "UTF-8")}")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "[]"

            if (!response.isSuccessful) {
                return@withContext Result.failure(IOException("User search failed: ${response.code}"))
            }

            val array = JSONArray(body)
            val list = mutableListOf<User>()
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                list.add(
                    User(
                        id = obj.getString("id"),
                        username = obj.getString("username"),
                        displayName = obj.getString("displayName"),
                        publicKey = obj.getString("publicKey")
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
            val request = newRequestBuilder("v1/users/${java.net.URLEncoder.encode(idOrUsername, "UTF-8")}")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                return@withContext Result.failure(IOException("User not found: ${response.code}"))
            }

            val obj = JSONObject(body)
            Result.success(
                User(
                    id = obj.getString("id"),
                    username = obj.getString("username"),
                    displayName = obj.getString("displayName"),
                    publicKey = obj.getString("publicKey")
                )
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun sendMessage(envelope: EncryptedEnvelope): Result<ChatMessage> =
        withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("recipientId", envelope.recipientId)
                    put("encryptedKey", envelope.encryptedKey)
                    put("ciphertext", envelope.ciphertext)
                    put("iv", envelope.iv)
                    put("authTag", envelope.authTag)
                }

                val request = newRequestBuilder("v1/messages")
                    .post(json.toString().toRequestBody(jsonMediaType))
                    .build()

                val response = client.newCall(request).execute()
                val body = response.body?.string() ?: ""

                if (!response.isSuccessful) {
                    val errorMsg = try {
                        JSONObject(body).optString("error", "Failed to send message.")
                    } catch (e: Exception) {
                        "Send failed: ${response.code}"
                    }
                    return@withContext Result.failure(IOException(errorMsg))
                }

                val resObj = JSONObject(body).getJSONObject("message")
                val msg = ChatMessage(
                    id = resObj.getString("id"),
                    senderId = resObj.getString("senderId"),
                    recipientId = resObj.getString("recipientId"),
                    ciphertext = resObj.getString("ciphertext"),
                    encryptedKey = resObj.getString("encryptedKey"),
                    iv = resObj.getString("iv"),
                    authTag = resObj.getString("authTag"),
                    createdAt = resObj.getLong("createdAt"),
                    status = resObj.optString("status", "sent")
                )
                Result.success(msg)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun getConversation(peerId: String): Result<List<ChatMessage>> =
        withContext(Dispatchers.IO) {
            try {
                val request = newRequestBuilder("v1/conversations/${java.net.URLEncoder.encode(peerId, "UTF-8")}")
                    .get()
                    .build()

                val response = client.newCall(request).execute()
                val body = response.body?.string() ?: "[]"

                if (!response.isSuccessful) {
                    return@withContext Result.failure(IOException("Failed to fetch messages: ${response.code}"))
                }

                val array = JSONArray(body)
                val list = mutableListOf<ChatMessage>()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    list.add(
                        ChatMessage(
                            id = obj.getString("id"),
                            senderId = obj.getString("senderId"),
                            recipientId = obj.getString("recipientId"),
                            ciphertext = obj.getString("ciphertext"),
                            encryptedKey = obj.getString("encryptedKey"),
                            iv = obj.getString("iv"),
                            authTag = obj.getString("authTag"),
                            createdAt = obj.getLong("createdAt"),
                            deliveredAt = if (obj.has("deliveredAt") && !obj.isNull("deliveredAt")) obj.getLong("deliveredAt") else null,
                            readAt = if (obj.has("readAt") && !obj.isNull("readAt")) obj.getLong("readAt") else null,
                            status = obj.optString("status", "sent")
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
            val json = JSONObject().apply {
                put("ids", JSONArray(ids))
            }
            val request = newRequestBuilder("v1/messages/delivered")
                .post(json.toString().toRequestBody(jsonMediaType))
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"
            val updated = JSONObject(body).optInt("updated", 0)
            Result.success(updated)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun markRead(ids: List<String>): Result<Int> = withContext(Dispatchers.IO) {
        try {
            if (ids.isEmpty()) return@withContext Result.success(0)
            val json = JSONObject().apply {
                put("ids", JSONArray(ids))
            }
            val request = newRequestBuilder("v1/messages/read")
                .post(json.toString().toRequestBody(jsonMediaType))
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"
            val updated = JSONObject(body).optInt("updated", 0)
            Result.success(updated)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun rotateKey(publicKey: String, keyBackup: String?): Result<User> =
        withContext(Dispatchers.IO) {
            try {
                val json = JSONObject().apply {
                    put("publicKey", publicKey)
                    keyBackup?.let { put("keyBackup", it) }
                }
                val request = newRequestBuilder("v1/account/rotate-key")
                    .post(json.toString().toRequestBody(jsonMediaType))
                    .build()

                val response = client.newCall(request).execute()
                val body = response.body?.string() ?: "{}"
                val userObj = JSONObject(body).getJSONObject("user")
                Result.success(
                    User(
                        id = userObj.getString("id"),
                        username = userObj.getString("username"),
                        displayName = userObj.getString("displayName"),
                        publicKey = userObj.getString("publicKey"),
                        keyBackup = userObj.optString("keyBackup", null)
                    )
                )
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
}
