package com.simplee2ee.chat.util

import android.os.Build
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

object NetworkUtils {

    /**
     * Detects if the current app is running in an Android Emulator or on a real physical device.
     */
    fun isRunningOnEmulator(): Boolean {
        return (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic"))
                || Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.startsWith("unknown")
                || Build.HARDWARE.contains("goldfish")
                || Build.HARDWARE.contains("ranchu")
                || Build.MODEL.contains("google_sdk")
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("Android SDK built for x86")
                || Build.MANUFACTURER.contains("Genymotion")
                || Build.PRODUCT.contains("sdk_google")
                || Build.PRODUCT.contains("google_sdk")
                || Build.PRODUCT.contains("sdk")
                || Build.PRODUCT.contains("sdk_x86")
                || Build.PRODUCT.contains("vbox86p")
                || Build.PRODUCT.contains("emulator")
                || Build.PRODUCT.contains("simulator")
    }

    /**
     * Legacy check maintained for backward compatibility. Direct cloud connection is used automatically.
     */
    fun checkServerUrlForPhysicalPhone(url: String): String? {
        return null
    }

    /**
     * Converts technical socket timeouts and connection errors into clear user-facing messages.
     */
    fun getFriendlyErrorMessage(err: Throwable, serverUrl: String = ""): String {
        val msg = err.message ?: ""
        if (msg.contains("<!doctype", ignoreCase = true) || msg.contains("JSONObject", ignoreCase = true)) {
            return "Connection updated. Please tap again to connect directly to the cloud database."
        }
        if (err is SocketTimeoutException || msg.contains("timeout", ignoreCase = true)) {
            return "Connection timed out. Please check your internet connection and try again."
        }
        if (err is ConnectException || msg.contains("failed to connect") || msg.contains("Connection refused", ignoreCase = true)) {
            return "Unable to connect to the cloud database. Please ensure your mobile data or Wi-Fi is connected."
        }
        if (err is UnknownHostException || msg.contains("Unable to resolve host")) {
            return "Network connection error. Please check your internet connection."
        }
        return msg.ifBlank { "Network error. Please check your connection and try again." }
    }
}
