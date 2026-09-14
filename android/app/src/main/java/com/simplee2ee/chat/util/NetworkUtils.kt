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
     * Checks if the user is using 10.0.2.2 on a physical phone, which is guaranteed to fail.
     */
    fun checkServerUrlForPhysicalPhone(url: String): String? {
        val trimmed = url.trim()
        if (!isRunningOnEmulator() && (trimmed.contains("10.0.2.2") || trimmed.contains("localhost") || trimmed.contains("127.0.0.1"))) {
            return "10.0.2.2 / localhost only works on an emulator. On a physical phone, please enter your computer's local Wi-Fi IP (e.g. http://192.168.1.5:3000) or your hosted server URL."
        }
        return null
    }

    /**
     * Converts technical socket timeouts and connection errors into clear user-facing messages.
     */
    fun getFriendlyErrorMessage(err: Throwable, serverUrl: String = ""): String {
        val msg = err.message ?: ""
        if (err is SocketTimeoutException || msg.contains("timeout", ignoreCase = true)) {
            return "Connection timed out. Please check your internet connection and try again."
        }
        if (err is ConnectException || msg.contains("failed to connect") || msg.contains("Connection refused", ignoreCase = true)) {
            return "Unable to connect to the chat service. Please ensure your mobile data or Wi-Fi is connected."
        }
        if (err is UnknownHostException || msg.contains("Unable to resolve host")) {
            return "Network connection error. Please check your internet connection."
        }
        return msg.ifBlank { "Network error. Please check your connection and try again." }
    }
}
