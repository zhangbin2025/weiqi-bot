package com.weiqi.app.bridge

import android.util.Log
import com.weiqi.app.MainActivity
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * PrintBridgeHandler - 打印桥接处理器
 *
 * 处理前缀: "print:"
 *
 * 支持的命令:
 * - print:invoke - 调用系统打印服务
 */
class PrintBridgeHandler(private val activity: MainActivity) : BridgeHandler {

    companion object {
        private const val TAG = "PrintBridgeHandler"
    }

    override val prefix: String = "print:"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val command = message.removePrefix(prefix)

        return when (command) {
            "invoke" -> {
                try {
                    // 获取GeckoSession并调用打印
                    val session = activity.getGeckoSession()
                    session?.let { geckoSession ->
                        // GeckoView提供了printPageContent方法
                        geckoSession.printPageContent()

                        GeckoResult.fromValue(
                            prompt.dismiss()
                        )
                    } ?: run {
                        Log.e(TAG, "GeckoSession is null")
                        GeckoResult.fromValue(
                            prompt.dismiss()
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Print failed", e)
                    GeckoResult.fromValue(
                        prompt.dismiss()
                    )
                }
            }
            else -> null
        }
    }
}
