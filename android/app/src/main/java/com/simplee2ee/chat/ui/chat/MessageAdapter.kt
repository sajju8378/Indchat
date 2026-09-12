package com.simplee2ee.chat.ui.chat

import android.graphics.BitmapFactory
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.simplee2ee.chat.R
import com.simplee2ee.chat.data.model.DecryptedMessage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MessageAdapter(
    private val currentUserId: String,
    private val onImageClicked: (DecryptedMessage) -> Unit
) : RecyclerView.Adapter<MessageAdapter.MessageViewHolder>() {

    private val messages = mutableListOf<DecryptedMessage>()
    private val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())

    fun submitList(newMessages: List<DecryptedMessage>) {
        messages.clear()
        messages.addAll(newMessages)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_message, parent, false)
        return MessageViewHolder(view)
    }

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        holder.bind(messages[position])
    }

    override fun getItemCount(): Int = messages.size

    inner class MessageViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val layoutSent: LinearLayout = itemView.findViewById(R.id.layoutSent)
        private val tvSentText: TextView = itemView.findViewById(R.id.tvSentText)
        private val tvSentTime: TextView = itemView.findViewById(R.id.tvSentTime)
        private val tvSentReceipt: TextView = itemView.findViewById(R.id.tvSentReceipt)
        private val ivSentPhoto: ImageView = itemView.findViewById(R.id.ivSentPhoto)

        private val layoutReceived: LinearLayout = itemView.findViewById(R.id.layoutReceived)
        private val tvReceivedText: TextView = itemView.findViewById(R.id.tvReceivedText)
        private val tvReceivedTime: TextView = itemView.findViewById(R.id.tvReceivedTime)
        private val ivReceivedPhoto: ImageView = itemView.findViewById(R.id.ivReceivedPhoto)

        fun bind(message: DecryptedMessage) {
            val isSent = message.senderId == currentUserId
            val context = itemView.context

            if (isSent) {
                layoutSent.visibility = View.VISIBLE
                layoutReceived.visibility = View.GONE

                tvSentTime.text = timeFormat.format(Date(message.createdAt))

                if (message.isImage && !message.imageBase64.isNullOrEmpty()) {
                    ivSentPhoto.visibility = View.VISIBLE
                    try {
                        val bytes = Base64.decode(message.imageBase64, Base64.DEFAULT)
                        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        ivSentPhoto.setImageBitmap(bmp)
                    } catch (e: Exception) {
                        ivSentPhoto.setImageResource(android.R.drawable.ic_menu_gallery)
                    }
                    tvSentText.visibility = View.GONE
                    ivSentPhoto.setOnClickListener { onImageClicked(message) }
                } else {
                    ivSentPhoto.visibility = View.GONE
                    tvSentText.visibility = View.VISIBLE
                    tvSentText.text = message.text
                }

                // Delivery & Read Receipts
                // sent: ✓, delivered: ✓✓ (grey), read: ✓✓ (blue)
                when (message.status) {
                    "read" -> {
                        tvSentReceipt.text = "✓✓"
                        tvSentReceipt.setTextColor(ContextCompat.getColor(context, R.color.receipt_read))
                    }
                    "delivered" -> {
                        tvSentReceipt.text = "✓✓"
                        tvSentReceipt.setTextColor(ContextCompat.getColor(context, R.color.receipt_delivered))
                    }
                    else -> {
                        tvSentReceipt.text = "✓"
                        tvSentReceipt.setTextColor(ContextCompat.getColor(context, R.color.receipt_sent))
                    }
                }
            } else {
                layoutSent.visibility = View.GONE
                layoutReceived.visibility = View.VISIBLE

                tvReceivedTime.text = timeFormat.format(Date(message.createdAt))

                if (message.isImage && !message.imageBase64.isNullOrEmpty()) {
                    ivReceivedPhoto.visibility = View.VISIBLE
                    try {
                        val bytes = Base64.decode(message.imageBase64, Base64.DEFAULT)
                        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        ivReceivedPhoto.setImageBitmap(bmp)
                    } catch (e: Exception) {
                        ivReceivedPhoto.setImageResource(android.R.drawable.ic_menu_gallery)
                    }
                    tvReceivedText.visibility = View.GONE
                    ivReceivedPhoto.setOnClickListener { onImageClicked(message) }
                } else {
                    ivReceivedPhoto.visibility = View.GONE
                    tvReceivedText.visibility = View.VISIBLE
                    tvReceivedText.text = message.text
                }
            }
        }
    }
}
