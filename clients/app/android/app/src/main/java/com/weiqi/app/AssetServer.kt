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

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val versionManager = VersionManager(context, client)
    private val fileServer = FileServer(context, client, cacheDir)
    private val proxyHandler = ProxyHandler(client, cacheDir)

    var onDemandCallback: OnDemandCallback?
        get() = fileServer.onDemandCallback
        set(value) {
            fileServer.onDemandCallback = value
            proxyHandler.onDemandCallback = value
        }

    interface ProgressCallback {
        fun onProgress(stage: String, progress: Int)
    }

    interface OnDemandCallback {
        fun onDownloadStart(filename: String, sizeBytes: Long)
        fun onDownloadProgress(filename: String, loaded: Long, total: Long)
        fun onDownloadComplete(filename: String)
    }

    companion object {
        private const val TAG = "AssetServer"
        val DEFAULT_PORT: Int get() = AppConfig.localPort
    }

    override fun serve(session: IHTTPSession): Response {
        var uri = session.uri

        // /proxy 反向代理路由
        if (uri == "/proxy" || uri == "/proxy/" || uri.startsWith("/proxy?") || uri.startsWith("/proxy/?")) {
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
        if (uri.endsWith("/")) {
            uri += "index.html"
        }
        // 无扩展名的路径可能是目录，尝试补 index.html
        if (!uri.substringAfterLast('/').contains('.')) {
            val indexPath = "$uri/index.html"
            val indexFile = File(cacheDir, indexPath)
            if (indexFile.exists() || indexFile.parentFile?.exists() == true) {
                uri = indexPath
            }
        }

        val method = session.method
        Logger.i(TAG, "$method ${session.uri} -> $uri")

        // 1. 尝试从缓存读取
        val cachedFile = File(cacheDir, uri)
        if (cachedFile.exists()) {
            Logger.d(TAG, "Cache hit: $uri")
            return fileServer.serveFile(cachedFile)
        }

        // 2. 缓存中没有，从远程下载
        Logger.i(TAG, "Cache miss, downloading: $uri")

        val fileName = uri.substringAfterLast('/').substringBefore('?')

        try {
            val remoteUrl = AppConfig.remoteUrl(uri)
            onDemandCallback?.onDownloadStart(fileName, -1)
            fileServer.downloadFile(remoteUrl, cachedFile)
            onDemandCallback?.onDownloadComplete(fileName)
            return fileServer.serveFile(cachedFile)
        } catch (e: Exception) {
            Logger.e(TAG, "Error serving $uri", e)
            onDemandCallback?.onDownloadComplete(fileName)
            return newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                "text/plain",
                "404 Not Found: $uri"
            )
        }
    }

    /**
     * 启动时初始化：检查版本 + 预下载资源
     *
     * 流程：
     * 1. 如果有升级标记 → 删除旧缓存（保留 models gz 模型文件）→ 预下载资源
     * 2. 没有升级标记 → 检查资源是否存在，不存在才预下载
     */
    fun checkAndUpdateVersion(callback: ProgressCallback? = null): Boolean {
        // 检查升级标记文件
        val flagFile = File(context.filesDir, "allow-upgrade.txt")
        val hasUpgradeFlag = flagFile.exists()

        if (hasUpgradeFlag) {
            flagFile.delete()
            Logger.d(TAG, "Upgrade flag found, checking version...")
        } else {
            Logger.d(TAG, "No upgrade flag, checking if resources exist...")
        }

        // 阶段1：版本检查 + 缓存清理（仅升级标记触发）
        var versionChanged = false
        var remoteVersion: String? = null

        if (hasUpgradeFlag) {
            callback?.onProgress("检查版本更新", 5)

            val localVersion = versionManager.readLocalVersion()
            remoteVersion = try {
                versionManager.fetchRemoteVersion()
            } catch (e: Exception) {
                Logger.w(TAG, "Failed to fetch remote version", e)
                null
            }

            Logger.d(TAG, "Local version: $localVersion, Remote version: $remoteVersion")

            versionChanged = localVersion != remoteVersion

            if (versionChanged) {
                Logger.i(TAG, "Version changed, clearing cache (preserving models/*.gz)")
                if (cacheDir.exists()) {
                    var deletedCount = 0
                    var preservedCount = 0

                    cacheDir.walkTopDown().forEach { file ->
                        if (file.isFile) {
                            val relativePath = file.relativeTo(cacheDir).path
                            val shouldPreserve = relativePath.startsWith("models/") && relativePath.endsWith(".gz")

                            if (shouldPreserve) {
                                Logger.d(TAG, "Preserving: $relativePath")
                                preservedCount++
                            } else {
                                if (file.delete()) {
                                    deletedCount++
                                } else {
                                    Logger.w(TAG, "Failed to delete: $relativePath")
                                }
                            }
                        }
                    }

                    Logger.i(TAG, "Cache cleared: deleted $deletedCount files, preserved $preservedCount files")

                    cacheDir.walkBottomUp().filter { it.isDirectory && it.listFiles()?.isEmpty() == true }.forEach {
                        it.delete()
                        Logger.d(TAG, "Removed empty directory: ${it.relativeTo(cacheDir)}")
                    }
                }
            } else {
                Logger.i(TAG, "Version up to date")
            }
        }

        // 阶段2：预下载资源
        // - 有升级标记：必须预下载
        // - 无升级标记：检查资源是否存在，不存在才预下载
        val needPreload = hasUpgradeFlag || !fileServer.hasCoreResources()
        
        if (needPreload) {
            Logger.i(TAG, "Preloading resources...")
            val preloadSuccess = fileServer.preloadCoreAssets(callback)

            // 预下载成功后，保存版本号
            if (preloadSuccess && versionChanged && remoteVersion != null) {
                Logger.i(TAG, "Preload success, saving new version: $remoteVersion")
                versionManager.saveLocalVersion(remoteVersion)
            } else if (!preloadSuccess && versionChanged) {
                Logger.w(TAG, "Preload failed, version not saved. Will retry on next launch.")
            }
        } else {
            Logger.i(TAG, "Resources already exist, skipping preload")
            callback?.onProgress("资源已就绪", 100)
        }

        return versionChanged
    }
}
