package com.simplee2ee.chat.ui.main

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.simplee2ee.chat.R
import com.simplee2ee.chat.data.model.ConversationSummary
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class RecentChatsAdapter(
    private val onChatClicked: (ConversationSummary) -> Unit
) : RecyclerView.Adapter<RecentChatsAdapter.ChatViewHolder>() {

    private val items = mutableListOf<ConversationSummary>()
    private val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())

    fun submitList(newItems: List<ConversationSummary>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChatViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_recent_chat, parent, false)
        return ChatViewHolder(view)
    }

    override fun onBindViewHolder(holder: ChatViewHolder, position: Int) {
        val item = items[position]
        holder.bind(item)
    }

    override fun getItemCount(): Int = items.size

    inner class ChatViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvAvatar: TextView = itemView.findViewById(R.id.tvPeerAvatar)
        private val tvDisplayName: TextView = itemView.findViewById(R.id.tvPeerDisplayName)
        private val tvUsername: TextView = itemView.findViewById(R.id.tvPeerUsername)
        private val tvLastMessage: TextView = itemView.findViewById(R.id.tvLastMessage)
        private val tvTime: TextView = itemView.findViewById(R.id.tvChatTime)
        private val tvUnread: TextView = itemView.findViewById(R.id.tvUnreadBadge)

        fun bind(summary: ConversationSummary) {
            val name = summary.peer.displayName.ifBlank { summary.peer.username }
            tvDisplayName.text = name
            tvUsername.text = "@${summary.peer.username}"
            tvAvatar.text = name.firstOrNull()?.uppercase() ?: "?"
            tvLastMessage.text = summary.lastMessageText

            if (summary.lastMessageTime > 0) {
                tvTime.text = timeFormat.format(Date(summary.lastMessageTime))
                tvTime.visibility = View.VISIBLE
            } else {
                tvTime.visibility = View.GONE
            }

            if (summary.unreadCount > 0) {
                tvUnread.text = summary.unreadCount.toString()
                tvUnread.visibility = View.VISIBLE
            } else {
                tvUnread.visibility = View.GONE
            }

            itemView.setOnClickListener {
                onChatClicked(summary)
            }
        }
    }
}
