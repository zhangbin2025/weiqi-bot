package com.weiqi.app.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.weiqi.app.util.Logger
import android.widget.Toast
import androidx.lifecycle.LifecycleCoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * FileBridgeHandler - 文件桥接处理器
 *
 * 处理 file:* 前缀的桥接消息，提供原生文件保存能力。
 * 目前支持：
 * - file:save - 通过 SAF (Storage Access Framework) 保存文件
 *
 * 代码来源：从 backup-master-20260625 的 PromptHandler.handleFilePrompt() 搬移。
 */
class FileBridgeHandler(
    private val activity: Activity,
    private val lifecycleScope: LifecycleCoroutineScope
) : BridgeHandler {

    companion object {
        private const val TAG = "FileBridgeHandler"
        const val SAVE_FILE_REQUEST_CODE = 1002
    }

    override val prefix: String = "file:"

    /** 文件保存请求回调 */
    private var saveFileCallback: ((ExportResult) -> Unit)? = null

    /** 待保存的文件数据 */
    private var pendingSaveData: PendingSaveData? = null

    /** 待保存数据结构 */
    private data class PendingSaveData(
        val filename: String,
        val content: String,  // Base64
        val mimeType: String
    )

    /** 文件保存结果 */
    data class ExportResult(
        val success: Boolean,
        val path: String? = null,
        val error: String? = null
    )

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        try {
            // 解析消息：file:action:json
            val parts = message.split(":", limit = 3)
            if (parts.size < 3) {
                Logger.w(TAG, "Invalid file prompt format: $message")
                return GeckoResult.fromValue(prompt.confirm("{\"error\":\"Invalid format\"}"))
            }

            val action = parts[1]
            val jsonStr = parts[2]

            if (action != "save") {
                Logger.w(TAG, "Unknown file action: $action")
                return GeckoResult.fromValue(prompt.confirm("{\"error\":\"Unknown action: $action\"}"))
            }

            return handleSave(prompt, jsonStr)
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to handle file prompt", e)
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"${e.message}\"}"))
        }
    }

    /**
     * 处理 file:save — 通过 SAF 保存文件
     *
     * 参数：
     * - filename: 文件名
     * - content: Base64 编码的文件内容
     * - mimeType: MIME 类型（可选，默认 application/octet-stream）
     */
    private fun handleSave(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        jsonStr: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        // 解析 JSON 参数
        val json = JSONObject(jsonStr)
        val filename = json.getString("filename")
        val content = json.getString("content")  // Base64
        val mimeType = json.optString("mimeType", "application/octet-stream")

        Logger.i(TAG, "file:save - filename=$filename, mimeType=$mimeType")

        // 保存待保存数据
        pendingSaveData = PendingSaveData(filename, content, mimeType)

        // 创建 SAF Intent
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, filename)
        }

        // 创建 GeckoResult 用于异步返回
        val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()

        // 设置回调
        saveFileCallback = { exportResult ->
            try {
                if (exportResult.success) {
                    val response = JSONObject().apply {
                        put("success", true)
                        put("path", exportResult.path)
                    }.toString()
                    result.complete(prompt.confirm(response))
                } else {
                    val response = JSONObject().apply {
                        put("success", false)
                        put("error", exportResult.error ?: "保存失败")
                    }.toString()
                    result.complete(prompt.confirm(response))
                }
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to complete save callback", e)
                result.complete(prompt.confirm("{\"error\":\"${e.message}\"}"))
            }
            saveFileCallback = null
            pendingSaveData = null
        }

        // 启动 SAF
        try {
            activity.startActivityForResult(intent, SAVE_FILE_REQUEST_CODE)
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to start SAF", e)
            saveFileCallback = null
            pendingSaveData = null
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"无法打开文件保存对话框\"}"))
        }

        return result
    }

    /**
     * 处理 SAF 返回结果
     *
     * 在 PromptHandler.onActivityResult() 中调用
     */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != SAVE_FILE_REQUEST_CODE) return

        if (resultCode == Activity.RESULT_OK && data != null && data.data != null) {
            val uri = data.data!!
            val saveData = pendingSaveData

            if (saveData != null) {
                // 写入文件
                val exportResult = writeToFile(uri, saveData.content, saveData.mimeType)
                saveFileCallback?.invoke(exportResult)
            } else {
                Logger.e(TAG, "No pending save data")
                saveFileCallback?.invoke(ExportResult(false, error = "无待保存数据"))
            }
        } else {
            // 用户取消
            Logger.i(TAG, "SAF cancelled by user")
            saveFileCallback?.invoke(ExportResult(false, error = "用户取消"))
        }
    }

    /**
     * 将 Base64 内容写入 SAF Uri
     */
    private fun writeToFile(uri: Uri, base64Content: String, mimeType: String): ExportResult {
        try {
            // 解码 Base64
            val bytes = android.util.Base64.decode(base64Content, android.util.Base64.DEFAULT)

            // 写入文件
            activity.contentResolver.openOutputStream(uri)?.use { output ->
                output.write(bytes)
            }

            // 获取文件名
            val fileName = uri.lastPathSegment ?: "unknown"
            Logger.i(TAG, "File saved successfully: $fileName")

            // 显示成功提示
            lifecycleScope.launch {
                Toast.makeText(activity, "已保存到: $fileName", Toast.LENGTH_SHORT).show()
            }

            return ExportResult(true, path = uri.toString())
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to write file", e)
            lifecycleScope.launch {
                Toast.makeText(activity, "保存失败: ${e.message}", Toast.LENGTH_SHORT).show()
            }
            return ExportResult(false, error = e.message ?: "写入失败")
        }
    }
}
