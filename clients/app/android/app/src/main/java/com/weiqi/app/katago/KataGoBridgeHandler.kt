package com.weiqi.app.katago

import android.app.Activity
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.LifecycleCoroutineScope
import com.weiqi.app.MainActivity
import com.weiqi.app.bridge.BridgeHandler
import com.weiqi.app.util.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import java.io.File

/**
 * KataGoBridgeHandler — KataGo 桥接处理器
 *
 * 支持的命令：
 * - katago:start:{json}  → 启动 KataGo 进程
 * - katago:send:{json}   → 发送查询到 stdin
 * - katago:status        → 查询进程状态
 * - katago:shutdown      → 关闭进程
 *
 * 设计原则：
 * - Kotlin 层只做路径解析 + 进程管理 + 数据透传
 * - 模型下载由 TS 层负责（同源走 AssetServer，非同源走 fetch）
 * - 下载后的文件在 filesDir/web/ 下，Kotlin 层直接引用
 * - analysis.cfg 内置在 assets，首次启动自动安装
 */
class KataGoBridgeHandler(
    private val activity: Activity,
    private val lifecycleScope: LifecycleCoroutineScope
) : BridgeHandler {

    companion object {
        private const val TAG = "KataGoBridgeHandler"
        
        // 全局单例 KataGo 进程
        private var globalKataGoProcess: KataGoProcess? = null
        private var currentModelPath: String? = null
        
        /**
         * 获取全局 KataGo 进程
         */
        fun getGlobalProcess(): KataGoProcess? = globalKataGoProcess
        
        /**
         * 获取当前模型路径
         */
        fun getCurrentModelPath(): String? = currentModelPath
        
        /**
         * 推送结果到指定的 GeckoSession
         * 
         * 用于 Service 中调用，可以直接推送结果到 Service 的 session
         */
        fun pushResultToSession(session: GeckoSession, json: String) {
            try {
                val escaped = json
                    .replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\n", "\\n")
                    .replace("\r", "")

                val js = "if(window.onKatagoResult)window.onKatagoResult('$escaped')"
                session.loadUri("javascript:$js")
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to push result to session", e)
            }
        }
        
        /**
         * 启动 KataGo 进程（供 Service 使用）
         * 
         * @param context Android Context
         * @param session GeckoSession 用于推送结果
         * @param modelPath 模型路径
         * @param configPath 配置路径
         * @return 是否启动成功
         */
        suspend fun startProcessForService(
            context: android.content.Context,
            session: GeckoSession,
            modelPath: String,
            configPath: String
        ): Pair<Boolean, String?> {
            // 如果进程已启动，检查模型是否相同
            if (globalKataGoProcess != null && globalKataGoProcess!!.isRunning) {
                return if (currentModelPath == modelPath) {
                    // 复用成功，更新结果推送的目标 session
                    globalKataGoProcess!!.onMessage = { msgJson ->
                        pushResultToSession(session, msgJson.toString())
                    }
                    // 推送 katago:ready 事件
                    val readyResp = JSONObject().put("type", "katago:ready")
                    pushResultToSession(session, readyResp.toString())
                    Pair(true, null)
                } else {
                    Pair(false, "KataGo process is running with a different model")
                }
            }
            
            // 解析路径
            val localModelPath = resolveWebPathStatic(context, modelPath)
            val localConfigPath = resolveWebPathStatic(context, configPath)
            
            // 验证文件存在
            val modelFile = java.io.File(localModelPath)
            if (!modelFile.exists()) {
                return Pair(false, "Model file not found: $localModelPath")
            }
            
            val configFile = java.io.File(localConfigPath)
            if (!configFile.exists()) {
                return Pair(false, "Config file not found: $localConfigPath")
            }
            
            // 创建新进程
            val proc = KataGoProcess(context)
            
            var usedMode = KataGoProcess.OpenCLMode.SYSTEM
            val pushMsg: (JSONObject) -> Unit = { msgJson ->
                pushResultToSession(session, msgJson.toString())
            }
            proc.onMessage = pushMsg
            proc.onExit = { exitCode ->
                if (usedMode == KataGoProcess.OpenCLMode.SYSTEM) {
                    Logger.i(TAG, "KataGo exited with SYSTEM OpenCL, falling back to BUNDLED")
                    val fallbackResp = JSONObject()
                        .put("type", "katago:fallback")
                        .put("from", "SYSTEM")
                        .put("to", "BUNDLED")
                        .put("reason", "Process exited with code " + exitCode)
                    pushMsg(fallbackResp)
                    
                    val fallbackProc = KataGoProcess(context)
                    usedMode = KataGoProcess.OpenCLMode.BUNDLED
                    fallbackProc.onMessage = pushMsg
                    fallbackProc.onExit = { fallbackExitCode ->
                        val resp = JSONObject().put("type", "katago:exit").put("exitCode", fallbackExitCode)
                        pushMsg(resp)
                        globalKataGoProcess = null
                        currentModelPath = null
                    }
                    fallbackProc.onReady = {
                        val resp = JSONObject().put("type", "katago:ready")
                        pushMsg(resp)
                    }
                    CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                        val fallbackOk = fallbackProc.start(localConfigPath, localModelPath, KataGoProcess.OpenCLMode.BUNDLED)
                        if (fallbackOk) {
                            globalKataGoProcess = fallbackProc
                        } else {
                            globalKataGoProcess = null
                            currentModelPath = null
                        }
                    }
                } else {
                    val resp = JSONObject().put("type", "katago:exit").put("exitCode", exitCode)
                    pushMsg(resp)
                    globalKataGoProcess = null
                    currentModelPath = null
                }
            }
            proc.onReady = {
                val resp = JSONObject().put("type", "katago:ready")
                pushMsg(resp)
            }
            
            // 启动进程（SYSTEM 模式优先）
            val ok = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                proc.start(localConfigPath, localModelPath, KataGoProcess.OpenCLMode.SYSTEM)
            }
            
            if (ok) {
                globalKataGoProcess = proc
                currentModelPath = modelPath
                return Pair(true, null)
            } else {
                return Pair(false, "Failed to start process")
            }
        }
        
        /**
         * 解析 web 路径（静态版本）
         */
        private fun resolveWebPathStatic(context: android.content.Context, path: String): String {
            // 已经是绝对路径
            if (path.startsWith("/data/") || path.startsWith("/storage/")) {
                return path
            }
            // web 相对路径 → filesDir/web/{path}
            val relative = path.removePrefix("/")
            return java.io.File(context.filesDir, "web/$relative").absolutePath
        }
    }

    override val prefix: String = "katago:"

    // 不再使用实例变量，改用全局单例
    // private var kataGoProcess: KataGoProcess? = null

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()

        try {
            val withoutPrefix = message.removePrefix(prefix)
            val colonIdx = withoutPrefix.indexOf(':')
            val command = if (colonIdx > 0) withoutPrefix.substring(0, colonIdx) else withoutPrefix
            val payload = if (colonIdx > 0) withoutPrefix.substring(colonIdx + 1) else ""

            when (command) {
                "start" -> handleStart(prompt, payload, result)
                "send" -> handleSend(prompt, payload, result)
                "status" -> handleStatus(prompt, result)
                "shutdown" -> handleShutdown(prompt, result)
                "downloadModel" -> handleDownloadModel(prompt, payload, result)
                else -> {
                    val resp = JSONObject().put("error", "Unknown command: $command")
                    result.complete(prompt.confirm(resp.toString()))
                }
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to handle katago prompt", e)
            val resp = JSONObject().put("error", e.message ?: "unknown")
            result.complete(prompt.confirm(resp.toString()))
        }

        return result
    }

    // ========== katago:start ==========

    /**
     * katago:start — 启动 KataGo 进程
     *
     * payload: {"modelPath":"models/katago-small.bin.gz"}
     *
     * modelPath 是 web 相对路径（和 Web 端一致），
     * Kotlin 层解析为本地绝对路径: filesDir/web/{modelPath}
     *
     * analysis.cfg 自动从 assets 安装（仅首次）。
     *
     * 响应: {"ok":true} 或 {"ok":false,"error":"..."}
     */
    private fun handleStart(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        payload: String,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        lifecycleScope.launch {
            try {
                val json = JSONObject(payload)
                val modelPath = json.getString("modelPath")
                val configPath = json.getString("configPath")

                // 检查全局进程是否已启动
                if (globalKataGoProcess != null && globalKataGoProcess!!.isRunning) {
                    // 检查模型是否相同
                    if (currentModelPath == modelPath) {
                        // 模型相同，直接复用
                        Logger.i(TAG, "KataGo process already running with same model, reusing")
                        // 更新结果推送的目标 session
                        globalKataGoProcess!!.onMessage = { msgJson ->
                            pushToTS(msgJson.toString())
                        }
                        // 推送 katago:ready 事件，让 TypeScript 层知道进程已就绪
                        val readyResp = JSONObject().put("type", "katago:ready")
                        pushToTS(readyResp.toString())
                        val resp = JSONObject().put("ok", true)
                        result.complete(prompt.confirm(resp.toString()))
                        return@launch
                    }
                    
                    // 模型不同，需要重启
                    Logger.i(TAG, "KataGo process running with different model, need to restart")
                    // 注意：这里不自动重启，而是返回错误，让 TS 层处理
                    val resp = JSONObject()
                        .put("ok", false)
                        .put("error", "KataGo process is running with a different model. Please wait for current tasks to finish.")
                        .put("code", "MODEL_SWITCH_WITH_RUNNING_PROCESS")
                    result.complete(prompt.confirm(resp.toString()))
                    return@launch
                }

                // 清理旧版 APK 遗留的配置目录（旧路径 filesDir/katago/，新版走 filesDir/web/katago/）
                val oldKatagoDir = File(activity.filesDir, "katago")
                if (oldKatagoDir.exists()) {
                    oldKatagoDir.deleteRecursively()
                    Logger.i(TAG, "Cleaned old katago dir: ${oldKatagoDir.absolutePath}")
                }

                // 解析模型路径
                val localModelPath = resolveWebPath(modelPath)
                Logger.i(TAG, "Model path: $modelPath -> $localModelPath")

                // 验证模型文件存在
                val modelFile = File(localModelPath)
                if (modelFile.exists() && localModelPath.endsWith(".gz")) {
                    // 校验 gzip 文件完整性：旧版 OkHttp 透明解压导致 .gz 文件实际是解压数据
                    try {
                        modelFile.inputStream().use { stream ->
                            val b1 = stream.read()
                            val b2 = stream.read()
                            if (b1 != 0x1f || b2 != 0x8b) {
                                Logger.w(TAG, "Corrupted gzip file (not gzip magic), deleting: $localModelPath")
                                modelFile.delete()
                            }
                        }
                    } catch (e: Exception) {
                        Logger.e(TAG, "Failed to check gzip header", e)
                    }
                }
                if (!modelFile.exists()) {
                    Logger.e(TAG, "Model file not found: $localModelPath")
                    val resp = JSONObject().put("ok", false).put("error", "Model file not found: $localModelPath")
                    result.complete(prompt.confirm(resp.toString()))
                    return@launch
                }
                Logger.i(TAG, "Model file exists: ${modelFile.absolutePath} size=${modelFile.length()}")

                // 解析配置路径
                val localConfigPath = resolveWebPath(configPath)
                Logger.i(TAG, "Config path: $configPath -> $localConfigPath")

                // 验证配置文件存在
                val configFile = File(localConfigPath)
                if (!configFile.exists()) {
                    Logger.e(TAG, "Config file not found: $localConfigPath")
                    val resp = JSONObject().put("ok", false).put("error", "Config file not found: $localConfigPath")
                    result.complete(prompt.confirm(resp.toString()))
                    return@launch
                }
                Logger.i(TAG, "Config file exists: ${configFile.absolutePath}")

                val proc = KataGoProcess(activity.applicationContext)
                globalKataGoProcess = proc
                currentModelPath = modelPath

                var usedMode = KataGoProcess.OpenCLMode.SYSTEM
                proc.onMessage = { msgJson ->
                    pushToTS(msgJson.toString())
                }
                proc.onExit = { exitCode ->
                    if (usedMode == KataGoProcess.OpenCLMode.SYSTEM) {
                        Logger.i(TAG, "KataGo exited with SYSTEM OpenCL, falling back to BUNDLED")
                        val fallbackResp = JSONObject()
                            .put("type", "katago:fallback")
                            .put("from", "SYSTEM")
                            .put("to", "BUNDLED")
                            .put("reason", "Process exited with code " + exitCode)
                        pushToTS(fallbackResp.toString())

                        val fallbackProc = KataGoProcess(activity.applicationContext)
                        usedMode = KataGoProcess.OpenCLMode.BUNDLED
                        fallbackProc.onMessage = { msgJson ->
                            pushToTS(msgJson.toString())
                        }
                        fallbackProc.onExit = { fallbackExitCode ->
                            val resp = JSONObject().put("type", "katago:exit").put("exitCode", fallbackExitCode)
                            pushToTS(resp.toString())
                            globalKataGoProcess = null
                            currentModelPath = null
                        }
                        fallbackProc.onReady = {
                            val resp = JSONObject().put("type", "katago:ready")
                            pushToTS(resp.toString())
                        }

                        lifecycleScope.launch(Dispatchers.IO) {
                            val fallbackOk = fallbackProc.start(localConfigPath, localModelPath, KataGoProcess.OpenCLMode.BUNDLED)
                            if (fallbackOk) {
                                globalKataGoProcess = fallbackProc
                            } else {
                                globalKataGoProcess = null
                                currentModelPath = null
                            }
                        }
                    } else {
                        val resp = JSONObject().put("type", "katago:exit").put("exitCode", exitCode)
                        pushToTS(resp.toString())
                        globalKataGoProcess = null
                        currentModelPath = null
                    }
                }
                proc.onReady = {
                    val resp = JSONObject().put("type", "katago:ready")
                    pushToTS(resp.toString())
                }

                val ok = withContext(Dispatchers.IO) {
                    proc.start(localConfigPath, localModelPath, KataGoProcess.OpenCLMode.SYSTEM)
                }

                if (ok) {
                    val resp = JSONObject().put("ok", true)
                    result.complete(prompt.confirm(resp.toString()))
                } else {
                    globalKataGoProcess = null
                    currentModelPath = null
                    val resp = JSONObject().put("ok", false).put("error", "Failed to start process")
                    result.complete(prompt.confirm(resp.toString()))
                }
            } catch (e: Exception) {
                Logger.e(TAG, "start failed", e)
                val resp = JSONObject().put("ok", false).put("error", e.message ?: "unknown")
                result.complete(prompt.confirm(resp.toString()))
            }
        }
    }


    /**
     * 校验 gzip 文件完整性
     * 
     * 通过读取整个文件验证 CRC32，检测下载中断、数据损坏等问题
     */
    private fun verifyGzip(filepath: String): Pair<Boolean, String> {
        return try {
            val file = File(filepath)
            if (!file.exists()) {
                return Pair(false, "File not found")
            }
            
            // 检查 gzip 魔数
            file.inputStream().use { stream ->
                val b1 = stream.read()
                val b2 = stream.read()
                if (b1 != 0x1f || b2 != 0x8b) {
                    return Pair(false, "Not a gzip file (invalid magic)")
                }
            }
            
            // 完整性校验：读取整个文件验证 CRC
            java.util.zip.GZIPInputStream(file.inputStream()).use { stream ->
                val buffer = ByteArray(8192)
                while (true) {
                    val read = stream.read(buffer)
                    if (read == -1) break
                }
            }
            
            Pair(true, "Valid gzip file")
        } catch (e: Exception) {
            Pair(false, "Gzip verification failed: ${e.message}")
        }
    }

    /**
     * 解析 web 相对路径为本地绝对路径
     *
     * "models/katago-small.bin.gz" → "filesDir/web/models/katago-small.bin.gz"
     * "/models/katago-small.bin.gz" → "filesDir/web/models/katago-small.bin.gz"
     * "/data/.../model.bin.gz"      → 原样返回（已经是绝对路径）
     */
    private fun resolveWebPath(path: String): String {
        // 已经是绝对路径
        if (path.startsWith("/data/") || path.startsWith("/storage/")) {
            return path
        }
        // web 相对路径 → filesDir/web/{path}
        val relative = path.removePrefix("/")
        return File(activity.filesDir, "web/$relative").absolutePath
    }



    // ========== katago:send ==========

    private fun handleSend(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        payload: String,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        val proc = globalKataGoProcess
        if (proc == null || !proc.isRunning) {
            val resp = JSONObject().put("ok", false).put("error", "KataGo process not running")
            result.complete(prompt.confirm(resp.toString()))
            return
        }

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                proc.sendRawLine(payload)
                val resp = JSONObject().put("ok", true)
                result.complete(prompt.confirm(resp.toString()))
            } catch (e: Exception) {
                Logger.e(TAG, "send failed", e)
                val resp = JSONObject().put("ok", false).put("error", e.message ?: "unknown")
                result.complete(prompt.confirm(resp.toString()))
            }
        }
    }

    // ========== katago:status ==========

    private fun handleStatus(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        val running = globalKataGoProcess?.isRunning == true
        val modelPath = currentModelPath
        val resp = JSONObject().put("running", running).put("modelPath", modelPath ?: JSONObject.NULL)
        result.complete(prompt.confirm(resp.toString()))
    }

    // ========== katago:shutdown ==========

    private fun handleShutdown(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        lifecycleScope.launch(Dispatchers.IO) {
            globalKataGoProcess?.shutdown()
            globalKataGoProcess = null
            currentModelPath = null
            val resp = JSONObject().put("ok", true)
            result.complete(prompt.confirm(resp.toString()))
        }
    }

    /**
     * 下载模型文件到 models 目录
     * 
     * 命令格式：katago:downloadModel:{"url":"https://...", "filename":"model.bin.gz"}
     * 
     * 功能：
     * - 从 URL 下载文件
     * - 保存到 filesDir/web/models/filename
     * - 推送下载进度到 JS 层
     * - 下载完成后通过 JavaScript 回调通知结果
     * 
     * ⚠️ 关键修改：立即返回响应，避免 prompt() 阻塞事件循环
     */
    private fun handleDownloadModel(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        payload: String,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        try {
            val json = JSONObject(payload)
            val url = json.getString("url")
            val filename = json.getString("filename")

            // ★ 先检查文件是否已存在且完整 → 同步返回，跳过异步下载流程
            // 只检查 gzip 魔数（2字节），不做完整 CRC 校验（模型文件几十MB，主线程会卡死）
            val modelsDir = File(activity.filesDir, "web/models")
            val targetFile = File(modelsDir, filename)
            if (targetFile.exists() && targetFile.length() > 0) {
                val isValidGzip = try {
                    targetFile.inputStream().use { s -> s.read() == 0x1f && s.read() == 0x8b }
                } catch (_: Exception) { false }
                if (isValidGzip) {
                    Logger.i(TAG, "Model already exists and valid (gzip magic OK), skipping download: ${targetFile.absolutePath}")
                    val resp = JSONObject().put("ok", true).put("async", false).put("path", "models/$filename")
                    result.complete(prompt.confirm(resp.toString()))
                    return
                }
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to check existing model", e)
        }

        // 文件不存在或损坏 → 异步下载
        val resp = JSONObject().put("ok", true).put("async", true)
        result.complete(prompt.confirm(resp.toString()))
        
        // 在 IO 线程中异步下载
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject(payload)
                val url = json.getString("url")
                val filename = json.getString("filename")
                
                Logger.i(TAG, "Downloading model: $url -> $filename")
                
                // 目标文件路径
                val modelsDir = File(activity.filesDir, "web/models")
                modelsDir.mkdirs()
                val targetFile = File(modelsDir, filename)
                
                // 如果文件已存在，推送成功消息（防御性，正常情况同步阶段已返回）
                if (targetFile.exists()) {
                    // 校验 gzip 完整性
                    val (isValid, msg) = verifyGzip(targetFile.absolutePath)
                    if (isValid) {
                        Logger.i(TAG, "Model already exists and valid: ${targetFile.absolutePath}")
                        val successJson = JSONObject()
                            .put("type", "katago:downloadComplete")
                            .put("ok", true)
                            .put("path", "models/$filename")
                        pushToTS(successJson.toString())
                        return@launch
                    } else {
                        // 文件损坏，删除后重新下载
                        Logger.w(TAG, "Model exists but corrupted: $msg, deleting: ${targetFile.absolutePath}")
                        targetFile.delete()
                    }
                }
                
                // 使用 OkHttp 下载
                val client = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
                    .build()
                
                val request = okhttp3.Request.Builder().url(url).build()
                val response = client.newCall(request).execute()
                
                if (!response.isSuccessful) {
                    // 推送错误消息
                    val errorJson = JSONObject()
                        .put("type", "katago:downloadComplete")
                        .put("ok", false)
                        .put("error", "HTTP ${response.code}: ${response.message}")
                    pushToTS(errorJson.toString())
                    return@launch
                }
                
                val contentLength = response.body?.contentLength() ?: -1L
                
                // ★ 原子写入：先下载到临时文件，完成后重命名
                val tempFile = File(modelsDir, "$filename.tmp")
                
                // 保存文件，同时推送进度
                response.body?.byteStream()?.use { input ->
                    tempFile.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var totalRead = 0L
                        var lastNotifyTime = System.currentTimeMillis()
                        var read: Int
                        
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            totalRead += read
                            
                            // 每 500ms 推送一次进度
                            val now = System.currentTimeMillis()
                            if (now - lastNotifyTime >= 500) {
                                val progress = if (contentLength > 0) totalRead.toDouble() / contentLength else 0.0
                                val progressJson = JSONObject()
                                    .put("type", "katago:downloadProgress")
                                    .put("filename", filename)
                                    .put("loaded", totalRead)
                                    .put("total", contentLength)
                                    .put("progress", progress)
                                pushToTS(progressJson.toString())
                                lastNotifyTime = now
                            }
                        }
                    }
                }
                
                // 下载完成，原子重命名
                if (tempFile.exists()) {
                    if (targetFile.exists()) {
                        targetFile.delete()
                    }
                    if (!tempFile.renameTo(targetFile)) {
                        Logger.e(TAG, "Failed to rename temp file: ${tempFile.absolutePath} -> ${targetFile.absolutePath}")
                        tempFile.delete()
                        val errorJson = JSONObject()
                            .put("type", "katago:downloadComplete")
                            .put("ok", false)
                            .put("error", "Failed to rename temp file")
                        pushToTS(errorJson.toString())
                        return@launch
                    }
                }
                
                Logger.i(TAG, "Model downloaded: ${targetFile.absolutePath}")
                // 推送下载完成消息
                val successJson = JSONObject()
                    .put("type", "katago:downloadComplete")
                    .put("ok", true)
                    .put("path", "models/$filename")
                pushToTS(successJson.toString())
                
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to download model", e)
                // 推送错误消息
                val errorJson = JSONObject()
                    .put("type", "katago:downloadComplete")
                    .put("ok", false)
                    .put("error", e.message ?: "unknown")
                pushToTS(errorJson.toString())
            }
        }
    }

    // ========== TS 层推送 ==========

    private fun pushToTS(json: String, targetSession: GeckoSession? = null) {
        try {
            val escaped = json
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "")

            // 优先使用传入的 session，否则尝试从 Activity 获取
            val session = targetSession ?: (activity as? MainActivity)?.getGeckoSession()
            
            session?.let {
                val js = "if(window.onKatagoResult)window.onKatagoResult('$escaped')"
                it.loadUri("javascript:$js")
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to push to TS", e)
        }
    }
}
