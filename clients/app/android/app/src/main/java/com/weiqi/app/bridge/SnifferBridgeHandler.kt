package com.weiqi.app.bridge

import com.weiqi.app.MainActivity
import com.weiqi.app.util.Logger
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * SnifferBridgeHandler - 抓包桥接处理器
 *
 * 处理 sniffer:// 前缀的 prompt 消息，路由到 SnifferManager。
 * 注意：sniffer:// 作为导航 URL 的拦截仍在 GeckoViewDelegateHandler.onLoadRequest 中，
 * 因为那是 NavigationDelegate 的职责，不走 prompt 通道。
 */
class SnifferBridgeHandler(
    private val activity: MainActivity
) : BridgeHandler {

    companion object {
        private const val TAG = "SnifferBridgeHandler"
    }

    override val prefix: String = "sniffer://"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val snifferManager = activity.getSnifferManager()
        
        if (snifferManager == null) {
            Logger.w(TAG, "SnifferManager not initialized")
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"SnifferManager not initialized\"}"))
        }

        val handled = snifferManager.handleSnifferUri(message)
        return GeckoResult.fromValue(prompt.confirm(if (handled) "ok" else "{\"error\":\"Unknown sniffer command\"}"))
    }
}
