package com.weiqi.app

import android.content.Context
import com.weiqi.app.util.Logger
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

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

    /**
     * 内置库【库级】下载锁：同一时刻同一库只允许一个全量下载在跑。
     * 多个业务并发首次用到同一库（如定式探索 + 做题）时，其余请求在此等待，
     * 等首个下载完成后直接读本地缓存，不再各自发起一轮下载。
     * 不同库各自独立，互不阻塞。
     */
    private val libraryLocks = ConcurrentHashMap<String, ReentrantLock>()

    /**
     * 【全局】整库补齐锁：不同库的后台下载也不并发。
     * 用户 2026-11-17 实测：多库后台异步下载进行中，首次请求定式 quiz 偶发 404，
     * 重新打开（后台已结束）即成功。故所有库共用一把锁，一次只补一个库。
     */
    private val globalLibraryLock = ReentrantLock()

    /** 已排队/正在补齐的库名，用于跳过重复触发（避免无谓起线程） */
    private val libraryQueued: MutableSet<String> =
        java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    /** 库目录前缀 -> 库名。清单由 scripts/build-assets.mjs 生成，不进 web-resources.zip。 */
    private val libraryDirs = mapOf(
        "shared/assets/data/joseki" to "joseki-trie",
        "shared/assets/data/games/life-and-death" to "life-and-death",
        "shared/assets/data/games/ai-review" to "ai-review"
    )

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
        private const val LIBRARY_MANIFEST = "library-files.json"
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
        // 只认「非空」缓存：0 字节残 file 直接 serve 会让前端拿到空 gzip / 空 JSON
        if (cachedFile.exists() && cachedFile.length() > 0) {
            Logger.d(TAG, "Cache hit: $uri")
            return fileServer.serveFile(cachedFile)
        }

        // 2. 缓存中没有，从远程下载
        Logger.i(TAG, "Cache miss, downloading: $uri")

        val fileName = uri.substringAfterLast('/').substringBefore('?')

        // 内置库：先立即响应触发请求的这个文件（不等整库），整库补齐放后台串行跑。
        // 这样后台 94 个文件里任何一个失败/超时都不会把本请求误判成 404。
        val lib = matchLibrary(uri)
        if (lib != null) {
            startLibraryBackground(lib.dirPrefix, lib.name)
        }

        return downloadSingle(uri, cachedFile, fileName)
    }

    private data class Library(val dirPrefix: String, val name: String)

    /** 请求路径是否落在某个内置库目录内（按最长前缀匹配，题库与棋谱库分开）。 */
    private fun matchLibrary(uri: String): Library? {
        val normalized = uri.trimStart('/').substringBefore('?')
        // 定式题库 quiz-* 与 trie 树同目录，但不纳入全量下载（用户 2026-11-17 明确排除），
        // 让它走原来的单文件按需下载即可。
        if (normalized.substringAfterLast('/').startsWith("quiz-")) return null
        return libraryDirs.entries
            .filter { (prefix, _) -> normalized == prefix || normalized.startsWith("$prefix/") }
            .maxByOrNull { it.key.length }
            ?.let { Library(it.key, it.value) }
    }

    /** 单文件按需下载（非库资源，或库清单未收录的兜底路径）。 */
    private fun downloadSingle(uri: String, cachedFile: File, fileName: String): NanoHTTPD.Response {
        val remoteUrl = AppConfig.remoteUrl(uri)
        onDemandCallback?.onDownloadStart(fileName, -1)
        // 失败时清掉可能损坏的缓存残 file 后重试一次，覆盖本地状态异常 / 瞬时网络
        var lastError: Exception? = null
        repeat(2) { attempt ->
            try {
                if (attempt > 0 && cachedFile.exists()) cachedFile.delete()
                fileServer.downloadFile(remoteUrl, cachedFile)
                onDemandCallback?.onDownloadComplete(fileName)
                return fileServer.serveFile(cachedFile)
            } catch (e: Exception) {
                lastError = e
                Logger.w(TAG, "Download attempt ${attempt + 1}/2 failed for $uri", e)
            }
        }
        Logger.e(TAG, "Error serving $uri", lastError)
        onDemandCallback?.onDownloadComplete(fileName)
        return newFixedLengthResponse(
            Response.Status.NOT_FOUND,
            "text/plain",
            "404 Not Found: $uri"
        )
    }

    /**
     * 后台触发整库补齐：不阻塞当前请求，失败只记日志。
     * 库级锁在 ensureLibrary 内，重复触发只会有一个补齐任务在跑。
     */
    private fun startLibraryBackground(dirPrefix: String, name: String) {
        // 已排队/正在补齐就直接跳过，不再无谓起线程
        if (!libraryQueued.add(name)) return
        Thread({
            try {
                ensureLibrary(dirPrefix, name)
            } catch (e: Exception) {
                Logger.e(TAG, "Library background ensure failed: $name", e)
            } finally {
                libraryQueued.remove(name)
            }
        }, "lib-ensure-$name").apply { isDaemon = true }.start()
    }

    /**
     * 确保某内置库已全量下载到本地（清单驱动补齐）。
     *
     * 只有缓存未命中才会走到这里，因此不能用「完成标记」短路——那样恰好会漏掉
     * 触发本次请求的那个缺失文件。改为按清单逐个检查、缺哪个补哪个：
     *   首次触发  -> 全部缺失，串行拉全（即「全量下载」）
     *   下载中断  -> 下次只补剩下的，不重复下
     *   库有新增  -> 补齐新文件
     *   已完整    -> 仅本地 stat 检查，零网络请求
     *
     * 库级锁保证同一时刻该库只有一个补齐任务在跑；并发的其它业务等待它完成后
     * 直接读本地缓存。库内【串行】await 逐个下载，绝不并发。
     * 清单由 scripts/build-assets.mjs 生成，不进 web-resources.zip。
     */
    private fun ensureLibrary(dirPrefix: String, name: String) {
        // 【外层】全局串行：不同库的后台补齐也排队，一次只跑一个。
        // 用户 2026-11-17 实测多库并发下载时首次请求 quiz 偶发 404。
        globalLibraryLock.withLock {
            Logger.i(TAG, "Library queue: start $name")
            // 【内层】库级锁：同一库重复触发时只有一个任务在跑。
            val lock = libraryLocks.computeIfAbsent(name) { ReentrantLock() }
            lock.withLock {
                val libDir = File(cacheDir, dirPrefix)
                Logger.i(TAG, "Library ensure start: $name")
                onDemandCallback?.onDownloadStart("内置库 $name", -1)
                try {
                    // 清单本身也按需下载
                    val manifestFile = File(libDir, LIBRARY_MANIFEST)
                    if (!manifestFile.exists() || manifestFile.length() == 0L) {
                        fileServer.downloadFile(
                            AppConfig.remoteUrl("$dirPrefix/$LIBRARY_MANIFEST"), manifestFile, false)
                    }
                    val files = parseManifest(manifestFile)
                    Logger.i(TAG, "Library $name manifest: ${files.size} files")

                    // 【关键】串行：一个文件下完再下下一个，绝不并发
                    var downloaded = 0
                    for ((i, rel) in files.withIndex()) {
                        val dest = File(libDir, rel)
                        if (dest.exists() && dest.length() > 0) continue
                        val remotePath = "$dirPrefix/${encodePath(rel)}"
                        fileServer.downloadFile(AppConfig.remoteUrl(remotePath), dest, false)
                        downloaded++
                        Logger.d(TAG, "Library $name: ${i + 1}/${files.size} $rel")
                    }
                    Logger.i(TAG, "Library ensure done: $name ($downloaded downloaded, ${files.size} total)")
                } finally {
                    onDemandCallback?.onDownloadComplete("内置库 $name")
                }
            }
            Logger.i(TAG, "Library queue: release $name")
        }
    }

    /** 解析 library-files.json（org.json 为 Android 内置，无需额外依赖）。 */
    private fun parseManifest(file: File): List<String> {
        val json = org.json.JSONObject(file.readText())
        val arr = json.getJSONArray("files")
        return (0 until arr.length()).map { arr.getString(it) }
            .filter { it.isNotBlank() && !it.contains("..") && !it.startsWith("/") }
    }

    /** 逐段 URL 编码（保留 / 分隔符，兼容中文文件名）。 */
    private fun encodePath(rel: String): String =
        rel.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8") }

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
