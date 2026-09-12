package com.simplee2ee.chat.ui.auth

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.simplee2ee.chat.ChatApplication
import com.simplee2ee.chat.R
import com.simplee2ee.chat.ui.main.MainActivity
import com.simplee2ee.chat.ui.recovery.KeyRecoveryDialog
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var app: ChatApplication
    private lateinit var etUsername: EditText
    private lateinit var etPassword: EditText
    private lateinit var etServerUrl: EditText
    private lateinit var btnLogin: Button
    private lateinit var btnGoRegister: Button
    private lateinit var tvError: TextView
    private lateinit var progressLoading: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        app = application as ChatApplication

        etUsername = findViewById(R.id.etUsername)
        etPassword = findViewById(R.id.etPassword)
        etServerUrl = findViewById(R.id.etServerUrl)
        btnLogin = findViewById(R.id.btnLogin)
        btnGoRegister = findViewById(R.id.btnGoRegister)
        tvError = findViewById(R.id.tvError)
        progressLoading = findViewById(R.id.progressLoading)

        etServerUrl.setText(app.getServerUrl())

        btnLogin.setOnClickListener {
            performLogin()
        }

        btnGoRegister.setOnClickListener {
            startActivity(Intent(this, RegisterActivity::class.java))
        }
    }

    private fun performLogin() {
        val usernameOrId = etUsername.text.toString().trim()
        val password = etPassword.text.toString()
        val serverUrl = etServerUrl.text.toString().trim()

        if (usernameOrId.isEmpty()) {
            showError("Please enter your username or ID.")
            return
        }
        if (password.isEmpty()) {
            showError("Please enter your password.")
            return
        }

        if (serverUrl.isNotEmpty()) {
            app.setServerUrl(serverUrl)
        }

        hideError()
        setLoading(true)

        lifecycleScope.launch {
            val result = app.apiClient.login(usernameOrId, password)
            setLoading(false)

            result.onSuccess { (token, user) ->
                // Check if device already has the RSA key in Keystore
                val crypto = app.cryptoManager
                var keyReady = crypto.hasDeviceRsaKey()

                if (!keyReady && !user.keyBackup.isNullOrBlank()) {
                    try {
                        // Recover private key from backup using password
                        val recoveredKey = crypto.recoverPrivateKeyFromBackup(user.keyBackup, password)
                        keyReady = true
                    } catch (e: Exception) {
                        keyReady = false
                    }
                }

                if (!keyReady) {
                    // Show requirement 3 warning dialog
                    KeyRecoveryDialog.show(
                        this@LoginActivity,
                        onConfirmNewKey = {
                            lifecycleScope.launch {
                                setLoading(true)
                                val newPublicPem = crypto.generateRsaKeyPair()
                                app.apiClient.authToken = token
                                app.apiClient.rotateKey(newPublicPem, null)
                                setLoading(false)
                                app.saveAuthSession(token, user.copy(publicKey = newPublicPem))
                                navigateToMain()
                            }
                        },
                        onCancel = {
                            app.clearAuthSession()
                        }
                    )
                } else {
                    app.saveAuthSession(token, user)
                    navigateToMain()
                }
            }.onFailure { err ->
                showError(err.message ?: "Login failed. Please check your connection and credentials.")
            }
        }
    }

    private fun navigateToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
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
        btnLogin.isEnabled = !loading
        btnGoRegister.isEnabled = !loading
    }
}
