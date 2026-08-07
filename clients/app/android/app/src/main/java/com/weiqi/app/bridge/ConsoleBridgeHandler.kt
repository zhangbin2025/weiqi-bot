package com.weiqi.app.bridge

import android.app.Activity
import com.weiqi.app.console.ConsoleHook
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * ConsoleBridgeHandler - 控制台日志桥接处理器
 *
 * 处理 console: 前缀的 prompt 消息，路由到 ConsoleHook。
 * 前端通过 prompt("console:" + JSON.stringify({...})) 发送日志。
 */
class ConsoleBridgeHandler(
    private val activity: Activity
) : BridgeHandler {

    companion object {
        private const val TAG = "ConsoleBridgeHandler"
    }

    override val prefix: String = "console:"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        // 去掉 "console:" 前缀，传递 JSON 给 ConsoleHook
        val json = message.substring(prefix.length)
        ConsoleHook.handleLog(json)
        return GeckoResult.fromValue(prompt.confirm("ok"))
    }
}
