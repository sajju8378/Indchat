package com.simplee2ee.chat.ui.search

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.simplee2ee.chat.ChatApplication
import com.simplee2ee.chat.R
import com.simplee2ee.chat.ui.chat.ChatActivity
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class SearchUserActivity : AppCompatActivity() {

    private lateinit var app: ChatApplication
    private lateinit var btnBack: ImageButton
    private lateinit var etSearchQuery: EditText
    private lateinit var btnClearSearch: ImageButton
    private lateinit var progressSearch: ProgressBar
    private lateinit var rvSearchResults: RecyclerView
    private lateinit var tvEmptySearch: TextView

    private lateinit var adapter: UserSearchAdapter
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_search_user)

        app = application as ChatApplication

        btnBack = findViewById(R.id.btnBack)
        etSearchQuery = findViewById(R.id.etSearchQuery)
        btnClearSearch = findViewById(R.id.btnClearSearch)
        progressSearch = findViewById(R.id.progressSearch)
        rvSearchResults = findViewById(R.id.rvSearchResults)
        tvEmptySearch = findViewById(R.id.tvEmptySearch)

        adapter = UserSearchAdapter { selectedUser ->
            val intent = Intent(this, ChatActivity::class.java).apply {
                putExtra(ChatActivity.EXTRA_PEER_ID, selectedUser.id)
                putExtra(ChatActivity.EXTRA_PEER_NAME, selectedUser.displayName)
                putExtra(ChatActivity.EXTRA_PEER_USERNAME, selectedUser.username)
                putExtra(ChatActivity.EXTRA_PEER_PUBLIC_KEY, selectedUser.publicKey)
            }
            startActivity(intent)
            finish()
        }

        rvSearchResults.layoutManager = LinearLayoutManager(this)
        rvSearchResults.adapter = adapter

        btnBack.setOnClickListener { finish() }

        btnClearSearch.setOnClickListener {
            etSearchQuery.setText("")
        }

        etSearchQuery.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val query = s?.toString()?.trim() ?: ""
                btnClearSearch.visibility = if (query.isNotEmpty()) View.VISIBLE else View.GONE
                debounceSearch(query)
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun debounceSearch(query: String) {
        searchJob?.cancel()
        if (query.isEmpty()) {
            adapter.submitList(emptyList())
            tvEmptySearch.text = "Type a username or display name to search users."
            tvEmptySearch.visibility = View.VISIBLE
            progressSearch.visibility = View.GONE
            return
        }

        searchJob = lifecycleScope.launch {
            delay(300) // 300ms debounce
            progressSearch.visibility = View.VISIBLE

            val result = app.apiClient.searchUsers(query)
            progressSearch.visibility = View.GONE

            result.onSuccess { users ->
                adapter.submitList(users)
                if (users.isEmpty()) {
                    tvEmptySearch.text = "No users found matching \"$query\""
                    tvEmptySearch.visibility = View.VISIBLE
                } else {
                    tvEmptySearch.visibility = View.GONE
                }
            }.onFailure { err ->
                tvEmptySearch.text = "Search failed: ${err.message}"
                tvEmptySearch.visibility = View.VISIBLE
            }
        }
    }
}
