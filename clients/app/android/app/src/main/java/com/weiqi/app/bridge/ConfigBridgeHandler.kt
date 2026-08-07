package com.weiqi.app.bridge

import android.content.Context
import com.weiqi.app.AppConfig
import com.weiqi.app.util.Logger
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import java.io.File

/**
 * ConfigBridgeHandler - 配置桥接处理器
 *
 * 处理 config:* 前缀的桥接消息，消息格式：
 * config:get
 * config:set:{filename}:{content}
 *
 * 返回应用配置信息，供 TypeScript 层使用
 */
class ConfigBridgeHandler(
    private val context: Context
) : BridgeHandler {

    companion object {
        private const val TAG = "ConfigBridgeHandler"
    }

    override val prefix: String = "config:"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()

        try {
            // 解析消息：config:{action}:{...}
            val parts = message.split(":")
            if (parts.size < 2) {
                return GeckoResult.fromValue(prompt.confirm("{\"error\":\"Invalid format\"}"))
            }

            val action = parts[1]

            when (action) {
                "get" -> {
                    // 返回配置信息
                    val config = JSONObject().apply {
                        put("localHost", AppConfig.localHost)
                        put("localPort", AppConfig.localPort)
                        put("localServerUrl", AppConfig.localServerUrl)
                        put("homeUrl", AppConfig.homeUrl)
                        put("remoteBase", AppConfig.remoteBase)
                        put("versionUrl", AppConfig.versionUrl)
                    }
                    Logger.d(TAG, "Returning config: $config")
                    result.complete(prompt.confirm(config.toString()))
                }

                "set" -> {
                    // 格式: config:set:{filename}:{content}
                    // 使用 split(limit=4) 保留 content 中的冒号
                    // parts[0]="config", parts[1]="set", parts[2]=filename, parts[3]=content
                    if (parts.size < 4) {
                        return GeckoResult.fromValue(prompt.confirm("{\"error\":\"Invalid format. Use: config:set:{filename}:{content}\"}"))
                    }

                    val filename = parts[2]
                    val content = parts[3]

                    try {
                        val file = File(context.filesDir, filename)
                        file.writeText(content)
                        Logger.d(TAG, "Set $filename = \"$content\"")
                        result.complete(prompt.confirm(JSONObject().put("success", true).put("file", filename).toString()))
                    } catch (e: Exception) {
                        Logger.e(TAG, "Failed to set $filename", e)
                        result.complete(prompt.confirm(JSONObject().put("success", false).put("error", e.message).toString()))
                    }
                }

                else -> {
                    Logger.w(TAG, "Unknown action: $action")
                    result.complete(prompt.confirm("{\"error\":\"Unknown action: $action\"}"))
                }
            }

            return result
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to handle config prompt", e)
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"${e.message}\"}"))
        }
    }
}
