package com.weiqi.app

import android.content.Context
import com.weiqi.app.util.Logger
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * AssetServer - HTTP 服务器
 *
 * 功能：
 * 1. 从本地缓存提供静态文件服务
 * 2. 缓存中没有时自动从远程下载
 * 3. 支持版本检查和自动更新
 * 4. 启动时预下载核心资源，带进度回调
 *
 * 重构后的结构：
 * - AssetServer: 路由分发（本类）
 * - FileServer: 静态文件服务
 * - ProxyHandler: 反向代理
 * - VersionManager: 版本管理
 * - MimeTypeHelper: MIME 类型工具
 */
class AssetServer(
    private val context: Context,
    port: Int = DEFAULT_PORT
) : NanoHTTPD(port) {

    private val cacheDir = File(context.filesDir, "web")
    
    // OkHttp 客户端，增加超时时间（连接 30s，读取 60s）
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    // 子组件
    private val versionManager = VersionManager(context, client)
    private val fileServer = FileServer(context, client, cacheDir)
    private val proxyHandler = ProxyHandler(client, cacheDir)

    // 按需下载回调（透传给 FileServer 和 ProxyHandler）
    var onDemandCallback: OnDemandCallback?
        get() = fileServer.onDemandCallback
        set(value) {
            fileServer.onDemandCallback = value
            proxyHandler.onDemandCallback = value
        }

    /**
     * 进度回调接口
     */
    interface ProgressCallback {
        /**
         * @param stage 当前阶段描述（如 "检查版本"、"下载资源"）
         * @param progress 进度 0-100
         */
        fun onProgress(stage: String, progress: Int)
    }

    /**
     * 按需下载回调接口（页面加载后，资源按需下载时触发）
     */
    interface OnDemandCallback {
        /**
         * 资源开始从远程下载
         * @param filename 文件名
         * @param sizeBytes 文件大小（未知为 -1）
         */
        fun onDownloadStart(filename: String, sizeBytes: Long)

        /**
         * 资源下载进度更新
         * @param filename 文件名
         * @param loaded 已下载字节数
         * @param total 总字节数（未知为 -1）
         */
        fun onDownloadProgress(filename: String, loaded: Long, total: Long)

        /**
         * 资源下载完成
         * @param filename 文件名
         */
        fun onDownloadComplete(filename: String)
    }

    companion object {
        private const val TAG = "AssetServer"
        val DEFAULT_PORT: Int get() = AppConfig.localPort
    }

    override fun serve(session: IHTTPSession): Response {
        var uri = session.uri

        // /proxy 反向代理路由（App 内跨域请求走本地）
        // 匹配 /proxy、/proxy/、/proxy?xxx（ProxyProvider 生成 /proxy/?url=...）
        if (uri == "/proxy" || uri == "/proxy/" || uri.startsWith("/proxy?") || uri.startsWith("/proxy/?")) {
            // CORS 预检请求直接返回
            if (session.method == Method.OPTIONS) {
                return newFixedLengthResponse(Response.Status.OK, "text/plain", "").apply {
                    addHeader("Access-Control-Allow-Origin", "*")
                    addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    addHeader("Access-Control-Allow-Headers", "*")
                    addHeader("Access-Control-Max-Age", "86400")
                }
            }
            return proxyHandler.handleProxy(session)
        }
        
        // WebSocket 测试页面
        if (uri == "/test-websocket" || uri == "/test-websocket.html") {
            return fileServer.serveTestWebSocketPage()
        }
        
        // SGF 文件缓存路由
        // 匹配 /sgf-cache/xxx.sgf，从应用的 cacheDir/sgf-cache 目录读取
        if (uri.startsWith("/sgf-cache/")) {
            val sgfFileName = uri.substringAfter("/sgf-cache/")
            val sgfFile = File(context.cacheDir, "sgf-cache/$sgfFileName")
            
            if (sgfFile.exists()) {
                Logger.d(TAG, "Serving SGF file: $uri")
                return fileServer.serveFile(sgfFile)
            } else {
                Logger.w(TAG, "SGF file not found: $uri")
                return newFixedLengthResponse(
                    Response.Status.NOT_FOUND,
                    "text/plain",
                    "404 Not Found: $uri"
                )
            }
        }

        // 移除开头的斜杠
        if (uri.startsWith("/")) {
            uri = uri.substring(1)
        }

        // 默认首页
        if (uri.isEmpty() || uri == "index.html") {
            uri = "index.html"
        }

        // 目录路径自动补 index.html
        // 例: /shared/ → /shared/index.html
        if (uri.endsWith("/")) {
            uri += "index.html"
        }
        // 无扩展名的路径可能是目录，尝试补 index.html
        // 例: /shared → /shared/index.html
        if (!uri.substringAfterLast('/').contains('.')) {
            val indexPath = "$uri/index.html"
            val indexFile = File(cacheDir, indexPath)
            if (indexFile.exists() || indexFile.parentFile?.exists() == true) {
                uri = indexPath
            }
        }

        val method = session.method
        val remoteAddr = session.remoteIpAddress
        Logger.i(TAG, "$method ${session.uri} -> $uri")

        // 1. 尝试从缓存读取
        val cachedFile = File(cacheDir, uri)
        if (cachedFile.exists()) {
            Logger.d(TAG, "Cache hit: $uri")
            return fileServer.serveFile(cachedFile)
        }

        // 2. 缓存中没有，从远程下载
        Logger.i(TAG, "Cache miss, downloading: $uri")
        
        // 提取文件名（只取最后一部分，避免路径字符）
        val fileName = uri.substringAfterLast('/').substringBefore('?')
        
        try {
            val remoteUrl = AppConfig.remoteUrl(uri)
            onDemandCallback?.onDownloadStart(fileName, -1)
            fileServer.downloadFile(remoteUrl, cachedFile)
            onDemandCallback?.onDownloadComplete(fileName)
            return fileServer.serveFile(cachedFile)
        } catch (e: Exception) {
            Logger.e(TAG, "Error serving $uri", e)
            // 确保下载完成回调总是被调用（无论成功或失败）
            onDemandCallback?.onDownloadComplete(fileName)
            return newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                "text/plain",
                "404 Not Found: $uri"
            )
        }
    }

    /**
     * 检查并更新版本，然后预下载核心资源
     *
     * @param callback 进度回调（在 IO 线程调用，UI 更新需切换线程）
     */
    fun checkAndUpdateVersion(callback: ProgressCallback? = null): Boolean {
        // 检查升级标记文件
        val flagFile = File(context.filesDir, "allow-upgrade.txt")
        if (!flagFile.exists()) {
            Logger.d(TAG, "No upgrade flag, skipping version check")
            return false
        }
        
        // 删除标记（一次性）
        flagFile.delete()
        Logger.d(TAG, "Upgrade flag found, checking version...")
        

        // 阶段1：检查版本
        callback?.onProgress("检查版本更新", 5)

        val localVersion = versionManager.readLocalVersion()
        val remoteVersion = try {
            versionManager.fetchRemoteVersion()
        } catch (e: Exception) {
            Logger.w(TAG, "Failed to fetch remote version, using cache", e)
            // 无法获取远程版本，跳过版本检查，直接预下载核心资源
            fileServer.preloadCoreAssets(callback)
            return false
        }

        Logger.d(TAG, "Local version: $localVersion, Remote version: $remoteVersion")

        val versionChanged = localVersion != remoteVersion

        if (versionChanged) {
            Logger.i(TAG, "Version changed, clearing cache")
            if (cacheDir.exists()) {
                // 列出删除前的文件
                val beforeFiles = cacheDir.walkTopDown().filter { it.isFile }.map { it.relativeTo(cacheDir).path }.toList()
                Logger.d(TAG, "Cache files before clear: ${beforeFiles.size} files")
                
                val deleted = cacheDir.deleteRecursively()
                Logger.d(TAG, "deleteRecursively() returned: $deleted")
                
                // 检查是否还有残留文件
                if (cacheDir.exists()) {
                    val afterFiles = cacheDir.walkTopDown().filter { it.isFile }.map { it.relativeTo(cacheDir).path }.toList()
                    Logger.e(TAG, "Cache clear incomplete! ${afterFiles.size} files remaining: $afterFiles")
                    
                    // 强制删除残留文件
                    afterFiles.forEach { filePath ->
                        val file = File(cacheDir, filePath)
                        val forceDeleted = file.delete()
                        Logger.d(TAG, "Force deleted $filePath: $forceDeleted")
                    }
                    
                    // 再次检查
                    if (cacheDir.exists()) {
                        val remainingFiles = cacheDir.walkTopDown().filter { it.isFile }.map { it.relativeTo(cacheDir).path }.toList()
                        if (remainingFiles.isNotEmpty()) {
                            Logger.e(TAG, "Still have ${remainingFiles.size} files after force delete: $remainingFiles")
                        }
                    }
                }
            }
            // 注意：不要在这里保存版本号！
            // 等待预下载成功后再保存
        } else {
            Logger.i(TAG, "Version up to date")
        }

        // 阶段2：预下载核心资源
        val preloadSuccess = fileServer.preloadCoreAssets(callback)

        // 阶段3：预下载成功后，保存版本号
        if (preloadSuccess && versionChanged) {
            Logger.i(TAG, "Preload success, saving new version: $remoteVersion")
            versionManager.saveLocalVersion(remoteVersion)
        } else if (!preloadSuccess && versionChanged) {
            Logger.w(TAG, "Preload failed, version not saved. Will retry on next launch.")
        }

        return versionChanged
    }
}
