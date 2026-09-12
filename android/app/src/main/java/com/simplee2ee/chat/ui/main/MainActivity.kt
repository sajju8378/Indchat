package com.simplee2ee.chat.ui.main

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import com.simplee2ee.chat.ChatApplication
import com.simplee2ee.chat.R
import com.simplee2ee.chat.ui.auth.LoginActivity
import com.simplee2ee.chat.ui.chat.ChatActivity
import com.simplee2ee.chat.ui.search.SearchUserActivity
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var app: ChatApplication
    private lateinit var tvUserAvatar: TextView
    private lateinit var tvUserDisplayName: TextView
    private lateinit var tvUserUsername: TextView
    private lateinit var tvUserId: TextView
    private lateinit var btnLogout: ImageButton
    private lateinit var cardSearchBar: View
    private lateinit var rvRecentChats: RecyclerView
    private lateinit var tvEmptyChats: TextView
    private lateinit var fabNewChat: ExtendedFloatingActionButton

    private lateinit var adapter: RecentChatsAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        app = application as ChatApplication

        tvUserAvatar = findViewById(R.id.tvUserAvatar)
        tvUserDisplayName = findViewById(R.id.tvUserDisplayName)
        tvUserUsername = findViewById(R.id.tvUserUsername)
        tvUserId = findViewById(R.id.tvUserId)
        btnLogout = findViewById(R.id.btnLogout)
        cardSearchBar = findViewById(R.id.cardSearchBar)
        rvRecentChats = findViewById(R.id.rvRecentChats)
        tvEmptyChats = findViewById(R.id.tvEmptyChats)
        fabNewChat = findViewById(R.id.fabNewChat)

        val currentUser = app.getSavedUser()
        if (currentUser == null) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        tvUserDisplayName.text = currentUser.displayName.ifBlank { currentUser.username }
        tvUserUsername.text = "@${currentUser.username}"
        tvUserId.text = getString(R.string.my_id, currentUser.id)
        tvUserAvatar.text = currentUser.displayName.firstOrNull()?.uppercase()
            ?: currentUser.username.firstOrNull()?.uppercase() ?: "U"

        adapter = RecentChatsAdapter { summary ->
            val intent = Intent(this, ChatActivity::class.java).apply {
                putExtra(ChatActivity.EXTRA_PEER_ID, summary.peer.id)
                putExtra(ChatActivity.EXTRA_PEER_NAME, summary.peer.displayName)
                putExtra(ChatActivity.EXTRA_PEER_USERNAME, summary.peer.username)
                putExtra(ChatActivity.EXTRA_PEER_PUBLIC_KEY, summary.peer.publicKey)
            }
            startActivity(intent)
        }

        rvRecentChats.layoutManager = LinearLayoutManager(this)
        rvRecentChats.adapter = adapter

        cardSearchBar.setOnClickListener {
            startActivity(Intent(this, SearchUserActivity::class.java))
        }

        fabNewChat.setOnClickListener {
            startActivity(Intent(this, SearchUserActivity::class.java))
        }

        btnLogout.setOnClickListener {
            lifecycleScope.launch {
                app.apiClient.logout()
                app.clearAuthSession()
                startActivity(Intent(this@MainActivity, LoginActivity::class.java))
                finish()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        loadRecentChats()
    }

    private fun loadRecentChats() {
        val summaries = app.dbHelper.getRecentConversations()
        if (summaries.isEmpty()) {
            tvEmptyChats.visibility = View.VISIBLE
            rvRecentChats.visibility = View.GONE
        } else {
            tvEmptyChats.visibility = View.GONE
            rvRecentChats.visibility = View.VISIBLE
            adapter.submitList(summaries)
        }
    }
}
