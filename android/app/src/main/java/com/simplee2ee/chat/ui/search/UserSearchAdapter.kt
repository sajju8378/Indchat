package com.simplee2ee.chat.ui.search

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.simplee2ee.chat.R
import com.simplee2ee.chat.data.model.User

class UserSearchAdapter(
    private val onUserClicked: (User) -> Unit
) : RecyclerView.Adapter<UserSearchAdapter.UserViewHolder>() {

    private val users = mutableListOf<User>()

    fun submitList(newUsers: List<User>) {
        users.clear()
        users.addAll(newUsers)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): UserViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_user_search, parent, false)
        return UserViewHolder(view)
    }

    override fun onBindViewHolder(holder: UserViewHolder, position: Int) {
        holder.bind(users[position])
    }

    override fun getItemCount(): Int = users.size

    inner class UserViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvAvatar: TextView = itemView.findViewById(R.id.tvUserAvatar)
        private val tvDisplayName: TextView = itemView.findViewById(R.id.tvUserDisplayName)
        private val tvUsername: TextView = itemView.findViewById(R.id.tvUserUsername)

        fun bind(user: User) {
            val name = user.displayName.ifBlank { user.username }
            tvDisplayName.text = name
            tvUsername.text = "@${user.username}"
            tvAvatar.text = name.firstOrNull()?.uppercase() ?: "U"

            itemView.setOnClickListener {
                onUserClicked(user)
            }
        }
    }
}
