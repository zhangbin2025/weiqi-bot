package com.weiqi.app.bridge

import android.print.PrintManager
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
        Log.d(TAG, "Received print command: $command")

        return when (command) {
            "invoke" -> {
                try {
                    // 获取GeckoSession
                    val session = activity.getGeckoSession()
                    if (session == null) {
                        Log.e(TAG, "GeckoSession is null")
                        return GeckoResult.fromValue(prompt.dismiss())
                    }

                    Log.d(TAG, "Attempting to print...")

                    // 方法1：尝试printPageContent（可能需要Android 10+）
                    try {
                        session.printPageContent()
                        Log.d(TAG, "printPageContent() called")
                    } catch (e: Exception) {
                        Log.w(TAG, "printPageContent failed, trying printToPdf", e)
                        
                        // 方法2：尝试printToPdf
                        try {
                            val result = GeckoResult<android.os.ParcelFileDescriptor>()
                            session.window?.printToPdf(result)
                            Log.d(TAG, "printToPdf() called")
                        } catch (e2: Exception) {
                            Log.e(TAG, "printToPdf also failed", e2)
                        }
                    }

                    GeckoResult.fromValue(prompt.dismiss())
                } catch (e: Exception) {
                    Log.e(TAG, "Print failed", e)
                    GeckoResult.fromValue(prompt.dismiss())
                }
            }
            else -> null
        }
    }
}
