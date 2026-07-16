package com.weiqi.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.weiqi.app.util.Logger
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.LifecycleCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.WebResponse
import java.io.File
import com.weiqi.app.task.TaskManager
import com.weiqi.app.debug.DebugBridge
import com.weiqi.app.bridge.BridgeHandler

/**
 * PromptHandler - 处理 GeckoView 的各种 Prompt 回调
 *
 * 职责：
 * - confirm/alert 弹窗
 * - prompt 输入框
 * - select 下拉框
 * - file 文件选择
 */
class PromptHandler(
    private val activity: Activity,
    private val lifecycleScope: LifecycleCoroutineScope,
    private val taskManager: TaskManager? = null
) {
    companion object {
        private const val TAG = "PromptHandler"
        private const val FILE_CHOOSER_REQUEST_CODE = 1001
    }

    /** 文件上传请求回调 */
    private var fileUploadCallback: ((Array<Uri>?) -> Unit)? = null

    /** BridgeHandler 注册表 */
    private val handlers = mutableMapOf<String, BridgeHandler>()

    /**
     * 注册 BridgeHandler
     */
    fun register(handler: BridgeHandler) {
        handlers[handler.prefix] = handler
        // 保存 FileBridgeHandler 引用，用于转发 SAF 结果
        if (handler is com.weiqi.app.bridge.FileBridgeHandler) {
            fileBridgeHandler = handler
        }
        Logger.i(TAG, "Registered bridge handler: ${handler.prefix}")
    }

    /**
     * 处理 JS confirm() — 显示确认对话框
     */
    fun onButtonPrompt(prompt: PromptDelegate.ButtonPrompt): GeckoResult<PromptDelegate.PromptResponse>? {
        Logger.i(TAG, "confirm() - title=${prompt.title}, msg=${prompt.message}")
        
        val result = GeckoResult<PromptDelegate.PromptResponse>()
        
        // 过滤标题中的 URL 前缀
        val title = filterTitle(prompt.title)
        
        AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(prompt.message)
            .setPositiveButton("确定") { dialog, _ ->
                dialog.dismiss()
                Logger.i(TAG, "confirm() -> user clicked 确定")
                result.complete(prompt.confirm(1))
            }
            .setNegativeButton("取消") { dialog, _ ->
                dialog.dismiss()
                Logger.i(TAG, "confirm() -> user clicked 取消")
                result.complete(prompt.confirm(0))
            }
            .setOnCancelListener {
                result.complete(prompt.confirm(0))
            }
            .create()
            .show()
        
        return result
    }

    /**
     * 处理 JS alert() — 显示提示对话框
     */
    fun onAlertPrompt(prompt: PromptDelegate.AlertPrompt): GeckoResult<PromptDelegate.PromptResponse>? {
        Logger.i(TAG, "alert() - title=${prompt.title}, msg=${prompt.message}")
        
        val result = GeckoResult<PromptDelegate.PromptResponse>()
        val title = filterTitle(prompt.title)
        
        AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(prompt.message)
            .setPositiveButton("确定") { dialog, _ ->
                dialog.dismiss()
                result.complete(prompt.dismiss())
            }
            .setOnCancelListener {
                result.complete(prompt.dismiss())
            }
            .create()
            .show()
        
        return result
    }

    /**
     * 处理 JS prompt() — 显示输入对话框
     */
    fun onTextPrompt(prompt: PromptDelegate.TextPrompt): GeckoResult<PromptDelegate.PromptResponse>? {
        val msg = prompt.message ?: ""
        Logger.i(TAG, "prompt() - title=${prompt.title}, msg=$msg")
        
        // 注入 TaskBridge
        if (msg == "injectTaskBridge") {
            Logger.i(TAG, "Received injectTaskBridge request")
            val mainActivity = activity as? MainActivity
            if (mainActivity == null) {
                Logger.e(TAG, "Activity is not MainActivity")
            } else {
                Logger.i(TAG, "Calling injectTaskBridge()")
                mainActivity.injectTaskBridge()
            }
            return GeckoResult.fromValue(prompt.confirm("ok"))
        }
        
        // BridgeHandler 路由
        val matchedPrefix = handlers.keys.find { msg.startsWith(it) }
        if (matchedPrefix != null) {
            return handlers[matchedPrefix]?.handle(prompt, msg)
        }
        
        return GeckoResult.fromValue(prompt.confirm(""))
    }

    /**
     * 处理 <select> 下拉框
     *
     * type=0: Menu (下拉菜单，点击后直接选中关闭)
     * type=1: Single (单选列表，显示 radio button)
     * type=2: Multiple (多选列表，显示 checkbox)
     */
    fun onChoicePrompt(prompt: PromptDelegate.ChoicePrompt): GeckoResult<PromptDelegate.PromptResponse>? {
        Logger.i(TAG, "choice() - title=${prompt.title}, type=${prompt.type}, choices=${prompt.choices.size}")
        
        val choices = prompt.choices
        if (choices.isEmpty()) {
            return GeckoResult.fromValue(prompt.dismiss())
        }
        
        val result = GeckoResult<PromptDelegate.PromptResponse>()
        val labels = choices.map { it.label }.toTypedArray()
        val title = prompt.title
        
        when (prompt.type) {
            0 -> {
                // Menu: 普通列表，点击后直接选中并关闭
                AlertDialog.Builder(activity)
                    .setTitle(title)
                    .setItems(labels) { dialog, which ->
                        dialog.dismiss()
                        Logger.i(TAG, "choice() -> selected: ${choices[which].label}")
                        result.complete(prompt.confirm(choices[which].id))
                    }
                    .setOnCancelListener {
                        result.complete(prompt.dismiss())
                    }
                    .create()
                    .show()
            }
            1 -> {
                // Single: 单选列表，显示 radio button
                val selectedIndex = choices.indexOfFirst { it.selected }
                AlertDialog.Builder(activity)
                    .setTitle(title)
                    .setSingleChoiceItems(labels, selectedIndex) { _, which ->
                        // 用户选中了某个选项，但不关闭对话框
                    }
                    .setPositiveButton("确定") { dialog, _ ->
                        dialog.dismiss()
                        // 需要获取当前选中的索引
                        // AlertDialog 的 setSingleChoiceItems 不支持直接获取选中项
                        // 这里简化处理：使用最后选中的选项
                        val selected = choices.find { it.selected } ?: choices.first()
                        result.complete(prompt.confirm(selected.id))
                    }
                    .setNegativeButton("取消") { dialog, _ ->
                        dialog.dismiss()
                        result.complete(prompt.dismiss())
                    }
                    .setOnCancelListener {
                        result.complete(prompt.dismiss())
                    }
                    .create()
                    .show()
            }
            2 -> {
                // Multiple: 多选列表，显示 checkbox
                val checkedItems = BooleanArray(choices.size) { i -> choices[i].selected }
                AlertDialog.Builder(activity)
                    .setTitle(title)
                    .setMultiChoiceItems(labels, checkedItems) { _, which, isChecked ->
                        checkedItems[which] = isChecked
                    }
                    .setPositiveButton("确定") { dialog, _ ->
                        dialog.dismiss()
                        val selectedIds = choices.filterIndexed { i, _ -> checkedItems[i] }.map { it.id }.toTypedArray()
                        Logger.i(TAG, "choice() -> selected: ${selectedIds.size} items")
                        result.complete(prompt.confirm(selectedIds))
                    }
                    .setNegativeButton("取消") { dialog, _ ->
                        dialog.dismiss()
                        result.complete(prompt.dismiss())
                    }
                    .setOnCancelListener {
                        result.complete(prompt.dismiss())
                    }
                    .create()
                    .show()
            }
            else -> {
                Logger.w(TAG, "Unknown choice type: ${prompt.type}, treating as menu")
                return GeckoResult.fromValue(prompt.dismiss())
            }
        }
        
        return result
    }

    /**
     * 处理文件上传 — <input type="file">
     */
    fun onFilePrompt(prompt: PromptDelegate.FilePrompt): GeckoResult<PromptDelegate.PromptResponse>? {
        val result = GeckoResult<PromptDelegate.PromptResponse>()
        
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            val types = prompt.mimeTypes
            if (types != null && types.isNotEmpty()) {
                val firstType = types[0]
                if (firstType.contains("/")) {
                    type = firstType
                    putExtra(Intent.EXTRA_MIME_TYPES, types)
                } else {
                    type = "*/*"
                }
            } else {
                type = "*/*"
            }
        }
        
        fileUploadCallback = { uris ->
            try {
                if (uris != null && uris.isNotEmpty()) {
                    result.complete(prompt.confirm(activity, uris))
                } else {
                    result.complete(prompt.dismiss())
                }
            } catch (e: Exception) {
                Logger.e(TAG, "File prompt callback error", e)
                result.complete(prompt.dismiss())
            }
            fileUploadCallback = null
        }
        
        try {
            activity.startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
        } catch (e: Exception) {
            Logger.e(TAG, "No file chooser available", e)
            result.complete(prompt.dismiss())
            fileUploadCallback = null
        }
        
        return result
    }

    /**
     * 处理文件上传结果
     */
    /** FileBridgeHandler 引用，用于转发 SAF 结果 */
    private var fileBridgeHandler: com.weiqi.app.bridge.FileBridgeHandler? = null

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        // 转发给 FileBridgeHandler 处理 SAF 结果
        fileBridgeHandler?.onActivityResult(requestCode, resultCode, data)
        
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                val uris = mutableListOf<Uri>()
                data.data?.let { uris.add(it) }
                data.clipData?.let { clip ->
                    for (i in 0 until clip.itemCount) {
                        uris.add(clip.getItemAt(i).uri)
                    }
                }
                
                // 将 content:// Uri 转换为 file:// Uri 或拷贝文件到缓存目录
                val fileUris = uris.mapNotNull { uri ->
                    try {
                        convertToFileUri(uri)
                    } catch (e: Exception) {
                        Logger.e(TAG, "Failed to convert URI: $uri", e)
                        null
                    }
                }
                
                fileUploadCallback?.invoke(if (fileUris.isNotEmpty()) fileUris.toTypedArray() else null)
            } else {
                fileUploadCallback?.invoke(null)
            }
        }
    }
    
    /**
     * 将 content:// Uri 转换为 file:// Uri
     * 
     * 对于 content:// Uri，我们需要将文件内容拷贝到应用缓存目录，
     * 然后返回该缓存文件的 file:// Uri
     */
    private fun convertToFileUri(uri: Uri): Uri? {
        // 如果已经是 file:// Uri，直接返回
        if (uri.scheme == "file") {
            return uri
        }
        
        // 对于 content:// Uri，拷贝文件到缓存目录
        if (uri.scheme == "content") {
            val fileName = getFileName(uri)
            
            // 创建缓存文件
            val cacheDir = File(activity.cacheDir, "upload")
            cacheDir.mkdirs()
            val cacheFile = File(cacheDir, fileName ?: "file_${System.currentTimeMillis()}")
            
            // 拷贝文件内容
            activity.contentResolver.openInputStream(uri)?.use { input ->
                cacheFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            
            // 返回 file:// Uri
            return Uri.fromFile(cacheFile)
        }
        
        return null
    }
    
    /**
     * 从 content:// Uri 获取文件名
     */
    private fun getFileName(uri: Uri): String? {
        var fileName: String? = null
        
        // 尝试从 ContentResolver 查询
        activity.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val displayNameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (displayNameIndex >= 0) {
                    fileName = cursor.getString(displayNameIndex)
                }
            }
        }
        
        // 如果查询失败，尝试从 Uri 的 path 中提取
        if (fileName == null) {
            fileName = uri.path?.substringAfterLast('/')
        }
        
        return fileName
    }

    /**
     * 处理文件下载
     */
    fun onExternalResponse(response: WebResponse, downloadHint: (String) -> Unit, hideDownloadHint: () -> Unit) {
        val filename = extractFilename(response) ?: return
        val mimeType = response.headers["Content-Type"] ?: guessMimeType(filename)
        
        Logger.i(TAG, "Download: $filename ($mimeType) from ${response.uri}")
        
        if (response.uri.startsWith("blob:")) {
            downloadFromBlob(response, filename, downloadHint, hideDownloadHint)
        } else {
            downloadWithManager(response.uri, filename, mimeType, downloadHint)
        }
    }

    // ==================== 私有方法 ====================

    /** 过滤标题中的 URL 前缀 */
    private fun filterTitle(title: String?): String {
        return title?.replace("The page at ${AppConfig.localServerUrl} says:", "")?.trim() ?: "提示"
    }

    /** 从 WebResponse 提取文件名 */
    private fun extractFilename(response: WebResponse): String? {
        val disposition = response.headers["Content-Disposition"]
        if (disposition != null) {
            val filenameRegex = Regex("""filename\*?=(?:UTF-8''|"?)([^";]+)"?""", RegexOption.IGNORE_CASE)
            filenameRegex.find(disposition)?.groupValues?.get(1)?.let {
                return java.net.URLDecoder.decode(it.trim(), "UTF-8")
            }
        }
        val urlPath = Uri.parse(response.uri).path
        if (!urlPath.isNullOrEmpty()) {
            val name = urlPath.substringAfterLast('/')
            if (name.isNotEmpty() && name.contains('.')) return name
        }
        return "download_${System.currentTimeMillis()}"
    }

    /** 根据文件扩展名猜测 MIME 类型 */
    private fun guessMimeType(filename: String): String {
        val ext = filename.substringAfterLast('.', "").lowercase()
        return android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    /** 使用系统 DownloadManager 下载 */
    private fun downloadWithManager(uri: String, filename: String, mimeType: String, downloadHint: (String) -> Unit) {
        try {
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
            val request = android.app.DownloadManager.Request(Uri.parse(uri))
                .setTitle(filename)
                .setDescription("围棋助手下载")
                .setMimeType(mimeType)
                .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, filename)
            
            dm.enqueue(request)
            downloadHint("下载中: $filename")
        } catch (e: Exception) {
            Logger.e(TAG, "Download failed: $filename", e)
        }
    }

    /** 从 Blob URL 下载 */
    private fun downloadFromBlob(response: WebResponse, filename: String, downloadHint: (String) -> Unit, hideDownloadHint: () -> Unit) {
        lifecycleScope.launch {
            try {
                downloadHint("下载中: $filename")
                
                val downloadsDir = File(activity.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "weiqi")
                downloadsDir.mkdirs()
                val destFile = File(downloadsDir, filename)
                
                withContext(Dispatchers.IO) {
                    response.body?.use { input ->
                        destFile.outputStream().use { output ->
                            input.copyTo(output)
                        }
                    }
                }
                
                Logger.i(TAG, "Blob download complete: ${destFile.absolutePath}")
                hideDownloadHint()
                downloadHint("已保存: ${destFile.name}")
                
                kotlinx.coroutines.delay(3000)
                hideDownloadHint()
            } catch (e: Exception) {
                Logger.e(TAG, "Blob download failed: $filename", e)
                hideDownloadHint()
            }
        }
    }
    
}
