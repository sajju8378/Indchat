package com.simplee2ee.chat.ui.auth

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.simplee2ee.chat.ChatApplication
import com.simplee2ee.chat.R
import com.simplee2ee.chat.ui.main.MainActivity

class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        Handler(Looper.getMainLooper()).postDelayed({
            val app = application as ChatApplication
            val savedUser = app.getSavedUser()
            val token = app.apiClient.authToken

            if (savedUser != null && !token.isNullOrBlank()) {
                startActivity(Intent(this, MainActivity::class.java))
            } else {
                startActivity(Intent(this, LoginActivity::class.java))
            }
            finish()
        }, 800)
    }
}
