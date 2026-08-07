package com.weiqi.app

import android.content.Context
import com.weiqi.app.util.Logger
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.zip.ZipInputStream

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
         * Web 资源压缩包 URL
         */
        private val WEB_RESOURCES_ZIP_URL: String get() = "$REMOTE_BASE/web-resources.zip"

        /**
         * 核心资源列表（用于检查是否存在）
         */
        private val CORE_RESOURCES = listOf(
            "index.html",
            "assistant/index.html"
        )
    }

    // 按需下载回调（仅用于运行时按需下载，预下载时不触发）
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
     * 从远程 URL 下载文件并保存到本地（带进度回调）
     * 
     * 使用临时文件下载，完成后才重命名，避免中断导致文件损坏
     * 
     * @param url 远程 URL
     * @param destFile 目标文件
     * @param notifyOnDemand 是否通知 onDemandCallback（预下载时为 false）
     */
    fun downloadFile(url: String, destFile: File, notifyOnDemand: Boolean = true) {
        val request = Request.Builder()
            .url(url)
            .header("Accept-Encoding", "identity")  // 禁止透明解压，保存原始 gzip 文件
            .build()

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
                            // 仅在按需下载时通知（预下载时 notifyOnDemand = false）
                            if (notifyOnDemand) {
                                val now = System.currentTimeMillis()
                                if (now - lastNotifyTime >= 500) {
                                    onDemandCallback?.onDownloadProgress(destFile.name, loaded, totalLength)
                                    lastNotifyTime = now
                                }
                            }
                        }
                        
                        // 最终进度通知
                        if (notifyOnDemand && loaded > 0) {
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
     * 检查核心资源是否存在
     */
    fun hasCoreResources(): Boolean {
        for (resource in CORE_RESOURCES) {
            val file = File(cacheDir, resource)
            if (!file.exists()) {
                Logger.d(TAG, "Core resource missing: $resource")
                return false
            }
        }
        return true
    }

    /**
     * 预下载核心资源
     * 
     * 下载 web-resources.zip 并解压到缓存目录
     * 
     * @return 是否预下载成功
     */
    fun preloadCoreAssets(callback: AssetServer.ProgressCallback?): Boolean {
        return preloadFromZip(callback)
    }

    /**
     * 下载 web-resources.zip 并解压（带详细进度）
     */
    private fun preloadFromZip(callback: AssetServer.ProgressCallback?): Boolean {
        val zipFile = File(cacheDir, "web-resources.zip.tmp")

        try {
            // 阶段1：下载 zip（带进度）
            val request = Request.Builder()
                .url(WEB_RESOURCES_ZIP_URL)
                .header("Accept-Encoding", "identity")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Download failed: ${response.code}")
                }

                val totalBytes = response.body?.contentLength() ?: -1L
                val totalMB = if (totalBytes > 0) String.format("%.1f", totalBytes / 1024.0 / 1024.0) else "?"

                callback?.onProgress("下载资源包 (0 / $totalMB MB)", 5)

                zipFile.parentFile?.mkdirs()
                val tempFile = File(zipFile.parentFile, zipFile.name + ".tmp")

                response.body?.byteStream()?.use { input ->
                    tempFile.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var loaded = 0L
                        var read: Int
                        var lastReportTime = System.currentTimeMillis()
                        
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            loaded += read

                            // 每 300ms 报告一次进度
                            val now = System.currentTimeMillis()
                            if (now - lastReportTime >= 300) {
                                val loadedMB = String.format("%.1f", loaded / 1024.0 / 1024.0)
                                val progress = if (totalBytes > 0) {
                                    5 + (loaded * 40 / totalBytes).toInt()
                                } else {
                                    5
                                }
                                callback?.onProgress("下载资源包 ($loadedMB / $totalMB MB)", progress)
                                lastReportTime = now
                            }
                        }

                        // 最终下载进度
                        val loadedMB = String.format("%.1f", loaded / 1024.0 / 1024.0)
                        callback?.onProgress("下载资源包 ($loadedMB / $totalMB MB)", 45)
                    }

                    // 校验大小
                    if (totalBytes > 0 && tempFile.length() != totalBytes) {
                        tempFile.delete()
                        throw IOException("Download incomplete")
                    }

                    // 重命名到正式文件
                    if (!tempFile.renameTo(zipFile)) {
                        tempFile.delete()
                        throw IOException("Failed to rename temp file")
                    }
                }
            }

            Logger.i(TAG, "Downloaded web-resources.zip: ${zipFile.length() / 1024 / 1024}MB")

            // 阶段2：解压
            var extractedCount = 0
            var totalEntries = 0

            ZipInputStream(zipFile.inputStream().buffered()).use { zis ->
                // 先统计条目数
                val entries = mutableListOf<java.util.zip.ZipEntry>()
                var entry = zis.nextEntry
                while (entry != null) {
                    entries.add(entry)
                    entry = zis.nextEntry
                }
                totalEntries = entries.size
                zis.close()

                // 重新打开解压
                ZipInputStream(zipFile.inputStream().buffered()).use { zis2 ->
                    entry = zis2.nextEntry
                    while (entry != null) {
                        val entryName = entry.name

                        // 安全检查：防止 zip slip
                        val destFile = File(cacheDir, entryName)
                        if (!destFile.canonicalPath.startsWith(cacheDir.canonicalPath)) {
                            Logger.w(TAG, "Zip slip detected, skipping: $entryName")
                            entry = zis2.nextEntry
                            continue
                        }

                        if (entry.isDirectory) {
                            destFile.mkdirs()
                        } else {
                            // 确保父目录存在
                            destFile.parentFile?.mkdirs()

                            destFile.outputStream().use { output ->
                                val buffer = ByteArray(8192)
                                var read: Int
                                while (zis2.read(buffer).also { read = it } != -1) {
                                    output.write(buffer, 0, read)
                                }
                            }

                            extractedCount++
                        }

                        val progress = 45 + (extractedCount * 50 / totalEntries.coerceAtLeast(1))
                        callback?.onProgress("解压资源 ($extractedCount/$totalEntries)", progress)

                        entry = zis2.nextEntry
                    }
                }
            }

            Logger.i(TAG, "Extracted $extractedCount files from web-resources.zip")
            callback?.onProgress("准备就绪", 100)
            return extractedCount > 0

        } catch (e: Exception) {
            Logger.e(TAG, "Failed to preload from zip", e)
            callback?.onProgress("资源加载失败", 100)
            return false
        } finally {
            // 清理临时 zip 文件
            if (zipFile.exists()) {
                zipFile.delete()
            }
        }
    }

    /**
     * 提供 WebSocket 测试页面
     */
    fun serveTestWebSocketPage(): NanoHTTPD.Response {
        return try {
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
