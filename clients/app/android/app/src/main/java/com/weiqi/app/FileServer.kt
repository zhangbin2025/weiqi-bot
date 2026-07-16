package com.weiqi.app

import android.content.Context
import com.weiqi.app.util.Logger
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

/**
 * 文件服务器
 * 负责静态文件服务、远程下载和预加载
 */
class FileServer(
    private val context: Context,
    private val client: OkHttpClient,
    private val cacheDir: File
) {
    
    companion object {
        private const val TAG = "FileServer"
        private val REMOTE_BASE: String get() = AppConfig.remoteBase
        
        /**
         * 核心资源列表（启动时必须下载的文件）
         * 预下载首页和助手页面，其他资源按需下载以节省存储空间
         */
        private val CORE_ASSETS = listOf(
            "index.html",
            "assistant/index.html"
        )
    }

    // 按需下载回调
    var onDemandCallback: AssetServer.OnDemandCallback? = null

    /**
     * 从文件创建 HTTP 响应
     */
    fun serveFile(file: File): NanoHTTPD.Response {
        val mimeType = MimeTypeHelper.getMimeType(file.name)
        return NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.OK,
            mimeType,
            file.inputStream(),
            file.length()
        ).apply {
            // 禁用缓存（本地文件服务本身就是最新的）
            addHeader("Cache-Control", "no-cache, no-store, must-revalidate")
            addHeader("Pragma", "no-cache")
            addHeader("Expires", "0")
            addHeader("Access-Control-Allow-Origin", "*")
        }
    }

    /**
     * 从远程 URL 下载文件并保存到本地
     * 
     * 使用临时文件下载，完成后才重命名，避免中断导致文件损坏
     * 
     * ✅ 使用 use 自动关闭 Response
     */
    fun downloadFile(url: String, destFile: File) {
        val request = Request.Builder()
            .url(url)
            .header("Accept-Encoding", "identity")  // 禁止透明解压，保存原始 gzip 文件
            .build()

        // ✅ 使用 use 自动关闭 Response
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Download failed: $url (code: ${response.code})")
            }

            // 确保父目录存在
            destFile.parentFile?.mkdirs()

            // 先下载到临时文件
            val tempFile = File(destFile.parentFile, destFile.name + ".tmp")
            val totalLength = response.body?.contentLength() ?: -1L
            
            try {
                response.body?.byteStream()?.use { input ->
                    tempFile.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var loaded = 0L
                        var read: Int
                        var lastNotifyTime = System.currentTimeMillis()
                        
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            loaded += read
                            
                            // 每 500ms 通知一次进度（避免过于频繁）
                            val now = System.currentTimeMillis()
                            if (now - lastNotifyTime >= 500) {
                                onDemandCallback?.onDownloadProgress(destFile.name, loaded, totalLength)
                                lastNotifyTime = now
                            }
                        }
                        
                        // 最终进度通知
                        if (loaded > 0) {
                            onDemandCallback?.onDownloadProgress(destFile.name, loaded, totalLength)
                        }
                    }
                }

                // 校验文件大小（如果服务器返回了 Content-Length）
                if (totalLength > 0 && tempFile.length() != totalLength) {
                    tempFile.delete()
                    throw IOException("Download incomplete: expected $totalLength bytes, got ${tempFile.length()}")
                }

                // 校验通过，重命名到正式文件
                if (!tempFile.renameTo(destFile)) {
                    tempFile.delete()
                    throw IOException("Failed to rename temp file to ${destFile.name}")
                }

                Logger.d(TAG, "Downloaded: $url -> ${destFile.path}")
            } catch (e: Exception) {
                tempFile.delete()
                throw e
            }
        }
    }

    /**
     * 预下载核心资源
     * 确保 GeckoView 加载页面时核心文件已经在本地
     * 
     * @return 是否至少有一个核心资源下载成功（用于判断是否保存版本号）
     */
    fun preloadCoreAssets(callback: AssetServer.ProgressCallback?): Boolean {
        val totalFiles = CORE_ASSETS.size
        var downloaded = 0
        var failed = 0

        callback?.onProgress("加载核心资源", 10)

        for (assetPath in CORE_ASSETS) {
            val cachedFile = File(cacheDir, assetPath)

            // 已存在则跳过
            if (cachedFile.exists()) {
                downloaded++
                val progress = 10 + (downloaded * 85 / totalFiles)
                callback?.onProgress("加载核心资源 ($downloaded/$totalFiles)", progress)
                continue
            }

            // 从远程下载
            try {
                val remoteUrl = "$REMOTE_BASE/$assetPath"
                downloadFile(remoteUrl, cachedFile)
                downloaded++
                Logger.d(TAG, "Preloaded: $assetPath")
                // 通知下载完成
                onDemandCallback?.onDownloadComplete(assetPath.substringAfterLast('/'))
            } catch (e: Exception) {
                failed++
                Logger.w(TAG, "Failed to preload: $assetPath", e)
                // 非核心资源下载失败不中断，GeckoView 加载时会再次尝试
            }

            val progress = 10 + ((downloaded + failed) * 85 / totalFiles)
            callback?.onProgress("加载核心资源 ($downloaded/$totalFiles)", progress)
        }

        callback?.onProgress("准备就绪", 100)
        Logger.i(TAG, "Preload complete: $downloaded success, $failed failed")
        
        // 返回是否至少有一个核心资源下载成功
        // 如果所有核心资源都下载失败，返回 false
        return downloaded > 0
    }

    /**
     * 提供 WebSocket 测试页面
     */
    fun serveTestWebSocketPage(): NanoHTTPD.Response {
        return try {
            // 从 assets 读取测试页面
            val html = context.assets.open("sniffer-extension/test-websocket.html").bufferedReader().use { it.readText() }
            NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "text/html; charset=utf-8", html)
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to load test page", e)
            NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.NOT_FOUND,
                "text/plain",
                "Test page not found"
            )
        }
    }
}
