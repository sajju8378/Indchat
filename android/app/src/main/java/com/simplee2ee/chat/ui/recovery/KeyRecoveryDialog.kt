package com.simplee2ee.chat.ui.recovery

import android.content.Context
import androidx.appcompat.app.AlertDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.simplee2ee.chat.R

object KeyRecoveryDialog {

    fun show(
        context: Context,
        onConfirmNewKey: () -> Unit,
        onCancel: () -> Unit
    ) {
        MaterialAlertDialogBuilder(context)
            .setTitle("Key Recovery Notice")
            .setMessage(R.string.key_recovery_warning)
            .setPositiveButton(R.string.create_new_key) { dialog, _ ->
                dialog.dismiss()
                onConfirmNewKey()
            }
            .setNegativeButton(R.string.cancel) { dialog, _ ->
                dialog.dismiss()
                onCancel()
            }
            .setCancelable(false)
            .show()
    }
}
