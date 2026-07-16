package com.weiqi.app.bridge

import com.weiqi.app.AppStateManager
import com.weiqi.app.MainActivity
import com.weiqi.app.debug.DebugBridge
import com.weiqi.app.util.Logger
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * DebugBridgeHandler - 调试桥接处理器
 *
 * 处理 debug:* 前缀的桥接消息，统一路由所有调试命令。
 * 包括文件操作、日志、存储、性能、设备信息、页面刷新等。
 */
class DebugBridgeHandler(
    private val activity: MainActivity
) : BridgeHandler {

    companion object {
        private const val TAG = "DebugBridgeHandler"
    }

    override val prefix: String = "debug:"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        try {
            // 解析消息：debug:action 或 debug:action:arg
            val parts = message.split(":", limit = 3)
            if (parts.size < 2) {
                Logger.w(TAG, "Invalid debug prompt format: $message")
                return GeckoResult.fromValue(prompt.confirm("{\"error\":\"Invalid format\"}"))
            }

            val action = parts[1]
            val arg = if (parts.size >= 3) parts[2] else ""

            val response = handleAction(action, arg)
            Logger.i(TAG, "debug:$action -> ${response.take(80)}")
            return GeckoResult.fromValue(prompt.confirm(response))
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to handle debug prompt", e)
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"${e.message}\"}"))
        }
    }

    /**
     * 分发调试命令
     */
    private fun handleAction(action: String, arg: String): String {
        val debugBridge = activity.debugBridge

        return when (action) {
            // 日志
            "getLogs" -> debugBridge.getLogs()
            "clearLogs" -> { debugBridge.clearLogs(); "ok" }

            // 存储
            "getFilesDir" -> debugBridge.getFilesDir()
            "getCacheDir" -> debugBridge.getCacheDir()
            "getFileSize" -> debugBridge.getFileSize(arg).toString()
            "clearCache" -> debugBridge.clearCache().toString()
            "getGeckoStorageSize" -> debugBridge.getGeckoStorageSize().toString()
            "listFiles" -> debugBridge.listFiles(arg)
            "deleteFile" -> debugBridge.deleteFile(arg).toString()

            // 性能
            "getMaxMemory" -> debugBridge.getMaxMemory().toString()
            "getTotalMemory" -> debugBridge.getTotalMemory().toString()
            "getFreeMemory" -> debugBridge.getFreeMemory().toString()
            "getCurrentTime" -> debugBridge.getCurrentTime().toString()

            // 设备信息
            "getAppVersion" -> debugBridge.getAppVersion()
            "getDeviceModel" -> debugBridge.getDeviceModel()
            "getAndroidVersion" -> debugBridge.getAndroidVersion()
            "getRunningSnifferSessions" -> debugBridge.getRunningSnifferSessions()

            // 页面刷新
            "refresh" -> {
                Logger.i(TAG, "refresh: reloading page, url=${AppStateManager.currentUrl}")
                val homeUrl = activity.getHomeUrl()
                val url = AppStateManager.currentUrl ?: homeUrl
                activity.runOnUiThread {
                    activity.getGeckoSession()?.loadUri(url)
                }
                "ok"
            }

            else -> "{\"error\":\"Unknown action: $action\"}"
        }
    }
}
