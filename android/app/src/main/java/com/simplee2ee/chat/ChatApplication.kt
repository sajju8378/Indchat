package com.simplee2ee.chat

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import com.simplee2ee.chat.crypto.CryptoManager
import com.simplee2ee.chat.data.local.ChatDatabaseHelper
import com.simplee2ee.chat.data.model.User
import com.simplee2ee.chat.data.remote.ApiClient

class ChatApplication : Application() {

    lateinit var cryptoManager: CryptoManager
        private set

    lateinit var dbHelper: ChatDatabaseHelper
        private set

    lateinit var apiClient: ApiClient
        private set

    private lateinit var prefs: SharedPreferences

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = getSharedPreferences("simple_e2ee_prefs", Context.MODE_PRIVATE)

        cryptoManager = CryptoManager(this)
        dbHelper = ChatDatabaseHelper(this, cryptoManager)

        val serverUrl = getServerUrl()
        apiClient = ApiClient(normalizeUrl(serverUrl))

        val savedToken = prefs.getString(PREF_AUTH_TOKEN, null)
        if (savedToken != null) {
            apiClient.authToken = savedToken
        }
    }

    fun saveAuthSession(token: String, user: User) {
        apiClient.authToken = token
        prefs.edit()
            .putString(PREF_AUTH_TOKEN, token)
            .putString(PREF_USER_ID, user.id)
            .putString(PREF_USERNAME, user.username)
            .putString(PREF_DISPLAY_NAME, user.displayName)
            .putString(PREF_PUBLIC_KEY, user.publicKey)
            .apply()
    }

    fun getSavedUser(): User? {
        val id = prefs.getString(PREF_USER_ID, null) ?: return null
        val username = prefs.getString(PREF_USERNAME, "") ?: ""
        val displayName = prefs.getString(PREF_DISPLAY_NAME, "") ?: ""
        val publicKey = prefs.getString(PREF_PUBLIC_KEY, "") ?: ""
        return User(id = id, username = username, displayName = displayName, publicKey = publicKey)
    }

    fun clearAuthSession() {
        apiClient.authToken = null
        prefs.edit()
            .remove(PREF_AUTH_TOKEN)
            .remove(PREF_USER_ID)
            .remove(PREF_USERNAME)
            .remove(PREF_DISPLAY_NAME)
            .remove(PREF_PUBLIC_KEY)
            .apply()
    }

    fun setServerUrl(url: String) {
        val normalized = normalizeUrl(url)
        prefs.edit().putString(PREF_SERVER_URL, normalized).apply()
        apiClient.baseUrl = normalized
    }

    fun getServerUrl(): String {
        val saved = prefs.getString(PREF_SERVER_URL, null)
        if (saved.isNullOrBlank() || saved.contains("10.0.2.2") || saved.contains("localhost") || saved.contains("127.0.0.1")) {
            return DEFAULT_SERVER_URL
        }
        return saved
    }

    companion object {
        lateinit var instance: ChatApplication
            private set

        private const val PREF_AUTH_TOKEN = "auth_token"
        private const val PREF_USER_ID = "user_id"
        private const val PREF_USERNAME = "username"
        private const val PREF_DISPLAY_NAME = "display_name"
        private const val PREF_PUBLIC_KEY = "public_key"
        private const val PREF_SERVER_URL = "server_url"

        // Default Cloud Run backend URL accessible from any phone on mobile data or Wi-Fi
        const val DEFAULT_SERVER_URL = "https://ais-dev-tqvv3pehwwutotp5fwjgou-312216031270.asia-southeast1.run.app"

        fun normalizeUrl(input: String): String {
            var trimmed = input.trim().removeSuffix("/")
            if (trimmed.isEmpty() || trimmed.contains("10.0.2.2") || trimmed.contains("localhost") || trimmed.contains("127.0.0.1")) {
                return DEFAULT_SERVER_URL
            }
            if (!trimmed.startsWith("http://", ignoreCase = true) && !trimmed.startsWith("https://", ignoreCase = true)) {
                trimmed = "https://$trimmed"
            }
            return trimmed
        }
    }
}
