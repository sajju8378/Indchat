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

        val serverUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        apiClient = ApiClient(serverUrl)

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
        prefs.edit().putString(PREF_SERVER_URL, url).apply()
        apiClient.baseUrl = url
    }

    fun getServerUrl(): String {
        return prefs.getString(PREF_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
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

        // Default local development URL (10.0.2.2 for Android Emulator, or localhost)
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:3000"
    }
}
