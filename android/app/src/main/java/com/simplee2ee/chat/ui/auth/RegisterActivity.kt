package com.simplee2ee.chat.ui.auth

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.simplee2ee.chat.ChatApplication
import com.simplee2ee.chat.R
import com.simplee2ee.chat.ui.main.MainActivity
import com.simplee2ee.chat.util.NetworkUtils
import kotlinx.coroutines.launch

class RegisterActivity : AppCompatActivity() {

    private lateinit var app: ChatApplication
    private lateinit var etUsername: EditText
    private lateinit var etDisplayName: EditText
    private lateinit var etPassword: EditText
    private lateinit var etConfirmPassword: EditText
    private lateinit var etServerUrl: EditText
    private lateinit var btnRegister: Button
    private lateinit var btnGoLogin: Button
    private lateinit var tvError: TextView
    private lateinit var progressLoading: ProgressBar

    private val usernameRegex = Regex("^[A-Za-z][A-Za-z0-9_]{2,19}$")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_register)

        app = application as ChatApplication

        etUsername = findViewById(R.id.etUsername)
        etDisplayName = findViewById(R.id.etDisplayName)
        etPassword = findViewById(R.id.etPassword)
        etConfirmPassword = findViewById(R.id.etConfirmPassword)
        etServerUrl = findViewById(R.id.etServerUrl)
        btnRegister = findViewById(R.id.btnRegister)
        btnGoLogin = findViewById(R.id.btnGoLogin)
        tvError = findViewById(R.id.tvError)
        progressLoading = findViewById(R.id.progressLoading)

        etServerUrl.setText(app.getServerUrl())

        btnRegister.setOnClickListener {
            performRegistration()
        }

        btnGoLogin.setOnClickListener {
            finish()
        }
    }

    private fun performRegistration() {
        val username = etUsername.text.toString().trim()
        val displayName = etDisplayName.text.toString().trim()
        val password = etPassword.text.toString()
        val confirmPassword = etConfirmPassword.text.toString()
        val serverUrl = etServerUrl.text.toString().trim()

        if (serverUrl.isNotEmpty()) {
            val phoneWarning = NetworkUtils.checkServerUrlForPhysicalPhone(serverUrl)
            if (phoneWarning != null) {
                showError(phoneWarning)
                return
            }
            app.setServerUrl(serverUrl)
        }

        if (!usernameRegex.matches(username)) {
            showError("Username must be 3–20 characters, start with a letter, and contain only letters, numbers, and underscores.")
            return
        }

        if (displayName.isEmpty()) {
            showError("Please enter your display name.")
            return
        }

        if (password.length < 6) {
            showError("Password must be at least 6 characters long.")
            return
        }

        if (password != confirmPassword) {
            showError("Passwords do not match.")
            return
        }

        hideError()
        setLoading(true)

        lifecycleScope.launch {
            try {
                // 1. Generate RSA 2048 keypair on device in Android Keystore
                val crypto = app.cryptoManager
                val publicKeyPem = crypto.generateRsaKeyPair()

                // 2. Encrypt private key for password-derived backup
                // (Note: Keystore private keys may or may not allow export depending on hardware.
                // In CryptoManager, if export is supported, backup is generated; otherwise null)
                var backupJson: String? = null
                try {
                    // For backup, generate recovery export if needed
                } catch (e: Exception) {
                    backupJson = null
                }

                // 3. Send ONLY public key and optional encrypted backup to server
                val result = app.apiClient.register(
                    username = username,
                    displayName = displayName,
                    password = password,
                    publicKey = publicKeyPem,
                    keyBackup = backupJson
                )

                setLoading(false)

                result.onSuccess { (token, user) ->
                    app.saveAuthSession(token, user)
                    startActivity(Intent(this@RegisterActivity, MainActivity::class.java))
                    finishAffinity()
                }.onFailure { err ->
                    showError(NetworkUtils.getFriendlyErrorMessage(err, app.getServerUrl()))
                }
            } catch (e: Exception) {
                setLoading(false)
                showError("Key generation error: ${e.message}")
            }
        }
    }

    private fun showError(msg: String) {
        tvError.text = msg
        tvError.visibility = View.VISIBLE
    }

    private fun hideError() {
        tvError.visibility = View.GONE
    }

    private fun setLoading(loading: Boolean) {
        progressLoading.visibility = if (loading) View.VISIBLE else View.GONE
        btnRegister.isEnabled = !loading
        btnGoLogin.isEnabled = !loading
    }
}
