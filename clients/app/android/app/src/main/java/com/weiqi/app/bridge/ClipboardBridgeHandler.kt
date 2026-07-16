package com.weiqi.app.bridge

import android.app.Activity
import android.content.Context
import android.content.ClipboardManager
import com.weiqi.app.util.Logger
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * ClipboardBridgeHandler - 剪贴板桥接处理器
 *
 * 处理 clipboard: 前缀的 prompt 消息。
 * 当前支持：
 * - clipboard:read → 读取 Android 原生剪贴板文本
 */
class ClipboardBridgeHandler(
    private val activity: Activity
) : BridgeHandler {

    companion object {
        private const val TAG = "ClipboardBridgeHandler"
    }

    override val prefix: String = "clipboard:"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val action = message.substring(prefix.length)

        val response = when (action) {
            "read" -> readClipboard()
            else -> "{\"error\":\"Unknown clipboard action: $action\"}"
        }

        return GeckoResult.fromValue(prompt.confirm(response))
    }

    private fun readClipboard(): String {
        return try {
            val clipboardManager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            clipboardManager?.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to read clipboard", e)
            ""
        }
    }
}
