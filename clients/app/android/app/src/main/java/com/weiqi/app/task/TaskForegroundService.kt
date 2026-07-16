@file:OptIn(DelicateCoroutinesApi::class)

package com.weiqi.app.task

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.weiqi.app.MainActivity
import com.weiqi.app.R
import com.weiqi.app.WeiqiApp
import com.weiqi.app.sniffer.SnifferManager
import com.weiqi.app.katago.KataGoBridgeHandler
import com.weiqi.app.katago.KataGoProcess
import com.weiqi.app.util.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession

/**
 * TaskForegroundService - 后台任务前台服务
 *
 * 职责：
 * - 提供前台服务，保证后台任务可靠执行
 * - 管理 GeckoRuntime 和 GeckoSession
 * - 处理任务完成/失败/进度
 * - 超时管理
 */
class TaskForegroundService : Service() {
    
    companion object {
        private const val TAG = "TaskForegroundService"
        private const val NOTIFICATION_CHANNEL_ID = "task_foreground"
        private const val NOTIFICATION_ID = 1001
        
        private const val DEFAULT_TIMEOUT_MS = 5 * 60 * 1000L  // 默认 5 分钟
        private const val MAX_TIMEOUT_MS = 30 * 60 * 1000L     // 最大 30 分钟
        
        // Intent Actions
        const val ACTION_EXECUTE_TASK = "com.weiqi.app.EXECUTE_TASK"
        const val ACTION_STOP_TASK = "com.weiqi.app.STOP_TASK"
        
        // Intent Extras
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_PAGE_URL = "pageUrl"
        const val EXTRA_PARAMS = "params"
        
        @Volatile
        private var geckoRuntime: GeckoRuntime? = null
    }
    
    private val mainHandler = Handler(Looper.getMainLooper())
    private var currentSession: GeckoSession? = null
    private var currentTaskId: String? = null
    private var timeoutRunnable: Runnable? = null
    private var lastProgressTime: Long = 0
    
    private lateinit var store: TaskStore
    private lateinit var notifier: TaskNotifier
    private var snifferManager: SnifferManager? = null
    
    override fun onCreate() {
        super.onCreate()
        
        store = TaskStore.getInstance(applicationContext)
        notifier = TaskNotifier(applicationContext)
        
        createNotificationChannel()
        Logger.i(TAG, "Service created")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_EXECUTE_TASK -> {
                val taskId = intent.getStringExtra(EXTRA_TASK_ID)
                val pageUrl = intent.getStringExtra(EXTRA_PAGE_URL)
                val paramsStr = intent.getStringExtra(EXTRA_PARAMS)
                
                if (taskId != null && pageUrl != null) {
                    val params = if (paramsStr != null) {
                        try {
                            JSONObject(paramsStr)
                        } catch (e: Exception) {
                            JSONObject()
                        }
                    } else {
                        JSONObject()
                    }
                    
                    executeTask(taskId, pageUrl, params)
                }
            }
            ACTION_STOP_TASK -> {
                val taskId = intent.getStringExtra(EXTRA_TASK_ID)
                if (taskId != null) {
                    cancelTask(taskId)
                }
            }
        }
        
        return START_NOT_STICKY
    }
    
    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
    
    override fun onDestroy() {
        super.onDestroy()
        cleanup()
        Logger.i(TAG, "Service destroyed")
    }
    
    /**
     * 执行任务
     */
    private fun executeTask(taskId: String, pageUrl: String, params: JSONObject) {
        GlobalScope.launch(Dispatchers.Main) {
            try {
                Logger.i(TAG, "Executing task $taskId: $pageUrl")
                
                // 检查是否已有任务在执行
                if (currentSession != null) {
                    Logger.w(TAG, "Another task is running, skipping $taskId")
                    store.markFailed(taskId, "Another task is running")
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return@launch
                }
                
                // 显示前台通知
                val notification = createForegroundNotification(taskId)
                
                // Android 14+ 需要指定 foregroundServiceType
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                
                // 更新任务状态
                store.markRunning(taskId)
                currentTaskId = taskId
                
                // 创建 GeckoSession
                val session = createGeckoSession(taskId)
                currentSession = session
                
                // 加载页面
                session.loadUri(pageUrl)
                
                // 设置超时
                setTimeout(taskId)
                
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to execute task $taskId", e)
                store.markFailed(taskId, e.message ?: "Unknown error")
                cleanup()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }
    
    /**
     * 取消任务
     */
    private fun cancelTask(taskId: String) {
        if (currentTaskId == taskId) {
            GlobalScope.launch {
                store.markCancelled(taskId)
                cleanup()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                Logger.i(TAG, "Cancelled task $taskId")
            }
        }
    }
    
    /**
     * 创建 GeckoSession
     */
    private fun createGeckoSession(taskId: String): GeckoSession {
        val runtime = getOrCreateRuntime()
        
        val session = GeckoSession()
        session.settings.setUserAgentOverride("WeiqiApp/1.0 (BackgroundTask)")
        
        // 创建 SnifferManager（如果还没创建）
        if (snifferManager == null) {
            snifferManager = SnifferManager(applicationContext, runtime) { fn, json ->
                // 通过 JS 注入回调数据到 fetcher 页面
                jsCallback(fn, json)
            }
            Logger.i(TAG, "SnifferManager created for background session")
        }
        
        // 设置 Prompt Delegate
        session.promptDelegate = object : GeckoSession.PromptDelegate {
            override fun onTextPrompt(
                session: GeckoSession,
                prompt: GeckoSession.PromptDelegate.TextPrompt
            ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                val message = prompt.message ?: ""
                Logger.d(TAG, "Prompt received: $message")
                
                // 处理 sniffer:// 协议（像 MainActivity 那样）
                if (message.startsWith("sniffer://")) {
                    Logger.d(TAG, "Handling sniffer:// protocol: $message")
                    handleSnifferUri(message)
                    return GeckoResult.fromValue(prompt.confirm("ok"))
                }
                
                // 处理 katago:* 的消息
                if (message.startsWith("katago:")) {
                    Logger.d(TAG, "Handling katago prompt in background task")
                    return handleKataGoPrompt(session, prompt, message)
                }
                
                // 处理 schedule 相关的 action
                val scheduleResult = handleSchedulePrompt(message)
                if (scheduleResult != null) {
                    return GeckoResult.fromValue(prompt.confirm(scheduleResult))
                }
                
                // 处理任务消息
                val shouldHandle = handleTaskPrompt(taskId, message)
                
                return if (shouldHandle) {
                    GeckoResult.fromValue(prompt.confirm("ok"))
                } else {
                    null
                }
            }
        }
        
        session.open(runtime)
        Logger.i(TAG, "Created GeckoSession for task $taskId")
        return session
    }
    
    /**
     * 处理 KataGo prompt
     */
    private fun handleKataGoPrompt(
        session: GeckoSession,
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
        
        try {
            val withoutPrefix = message.removePrefix("katago:")
            val colonIdx = withoutPrefix.indexOf(':')
            val command = if (colonIdx > 0) withoutPrefix.substring(0, colonIdx) else withoutPrefix
            val payload = if (colonIdx > 0) withoutPrefix.substring(colonIdx + 1) else ""

            when (command) {
                "start" -> handleKataGoStart(session, prompt, payload, result)
                "send" -> handleKataGoSend(prompt, payload, result)
                "status" -> handleKataGoStatus(prompt, result)
                "shutdown" -> handleKataGoShutdown(prompt, result)
                "downloadModel" -> handleKataGoDownloadModel(prompt, payload, result, session)
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
    
    /**
     * 处理 katago:start
     */
    private fun handleKataGoStart(
        session: GeckoSession,
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        payload: String,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        GlobalScope.launch(Dispatchers.Main) {
            try {
                val json = JSONObject(payload)
                val modelPath = json.getString("modelPath")
                val configPath = json.getString("configPath")

                // 调用静态方法启动进程
                val (success, error) = KataGoBridgeHandler.startProcessForService(
                    applicationContext,
                    session,
                    modelPath,
                    configPath
                )
                
                if (success) {
                    val resp = JSONObject().put("ok", true)
                    result.complete(prompt.confirm(resp.toString()))
                } else {
                    val resp = JSONObject().put("ok", false).put("error", error ?: "unknown")
                    result.complete(prompt.confirm(resp.toString()))
                }
            } catch (e: Exception) {
                Logger.e(TAG, "katago:start failed", e)
                val resp = JSONObject().put("ok", false).put("error", e.message ?: "unknown")
                result.complete(prompt.confirm(resp.toString()))
            }
        }
    }
    
    /**
     * 处理 katago:send
     */
    private fun handleKataGoSend(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        payload: String,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        val globalProcess = KataGoBridgeHandler.getGlobalProcess()
        if (globalProcess == null || !globalProcess.isRunning) {
            val resp = JSONObject().put("ok", false).put("error", "KataGo process not running")
            result.complete(prompt.confirm(resp.toString()))
            return
        }

        GlobalScope.launch(Dispatchers.IO) {
            try {
                globalProcess.sendRawLine(payload)
                val resp = JSONObject().put("ok", true)
                result.complete(prompt.confirm(resp.toString()))
            } catch (e: Exception) {
                Logger.e(TAG, "katago:send failed", e)
                val resp = JSONObject().put("ok", false).put("error", e.message ?: "unknown")
                result.complete(prompt.confirm(resp.toString()))
            }
        }
    }
    
    /**
     * 处理 katago:status
     */
    private fun handleKataGoStatus(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        val running = KataGoBridgeHandler.getGlobalProcess()?.isRunning == true
        val resp = JSONObject().put("running", running)
        result.complete(prompt.confirm(resp.toString()))
    }
    
    /**
     * 处理 katago:shutdown
     */
    private fun handleKataGoShutdown(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>
    ) {
        GlobalScope.launch(Dispatchers.IO) {
            KataGoBridgeHandler.getGlobalProcess()?.shutdown()
            val resp = JSONObject().put("ok", true)
            result.complete(prompt.confirm(resp.toString()))
        }
    }
    
    /**
     * 处理 katago:downloadModel
     */
    private fun handleKataGoDownloadModel(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        payload: String,
        result: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>,
        session: GeckoSession
    ) {
        // 立即返回响应，避免阻塞 TypeScript 层的事件循环
        val resp = JSONObject().put("ok", true).put("async", true)
        result.complete(prompt.confirm(resp.toString()))
        
        // 在 IO 线程中异步下载
        GlobalScope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject(payload)
                val url = json.getString("url")
                val filename = json.getString("filename")
                
                Logger.i(TAG, "Downloading model: $url -> $filename")
                
                // 目标文件路径
                val modelsDir = java.io.File(filesDir, "web/models")
                modelsDir.mkdirs()
                val targetFile = java.io.File(modelsDir, filename)
                
                // 如果文件已存在，延迟推送成功消息
                if (targetFile.exists()) {
                    Logger.i(TAG, "Model already exists: ${targetFile.absolutePath}")
                    Handler(Looper.getMainLooper()).postDelayed({
                        val successJson = JSONObject()
                            .put("type", "katago:downloadComplete")
                            .put("ok", true)
                            .put("path", "models/$filename")
                        pushToTS(session, successJson.toString())
                    }, 100)
                    return@launch
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
                    pushToTS(session, errorJson.toString())
                    return@launch
                }
                
                val contentLength = response.body?.contentLength() ?: -1L
                
                // 保存文件，同时推送进度
                response.body?.byteStream()?.use { input ->
                    targetFile.outputStream().use { output ->
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
                                pushToTS(session, progressJson.toString())
                                lastNotifyTime = now
                            }
                        }
                    }
                }
                
                Logger.i(TAG, "Model downloaded: ${targetFile.absolutePath}")
                // 推送下载完成消息
                val successJson = JSONObject()
                    .put("type", "katago:downloadComplete")
                    .put("ok", true)
                    .put("path", "models/$filename")
                pushToTS(session, successJson.toString())
                
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to download model", e)
                // 推送错误消息
                val errorJson = JSONObject()
                    .put("type", "katago:downloadComplete")
                    .put("ok", false)
                    .put("error", e.message ?: "unknown")
                pushToTS(session, errorJson.toString())
            }
        }
    }
    
    /**
     * 获取或创建 GeckoRuntime
     */
    private fun getOrCreateRuntime(): GeckoRuntime {
        return geckoRuntime ?: synchronized(this) {
            geckoRuntime ?: createRuntime().also { geckoRuntime = it }
        }
    }
    
    /**
     * 创建 GeckoRuntime
     */
    private fun createRuntime(): GeckoRuntime {
        val app = applicationContext as WeiqiApp
        return WeiqiApp.getOrCreateRuntime(app)
    }
    
    /**
     * 处理 schedule 相关的 prompt
     */
    private fun handleSchedulePrompt(message: String): String? {
        try {
            val parts = message.split(":", limit = 4)
            if (parts.size < 3 || parts[0] != "task" || parts[1] != "schedule") {
                return null
            }
            
            val action = parts[2]
            
            when (action) {
                "get" -> {
                    val scheduleId = parts.getOrNull(3) ?: return null
                    val scheduleManager = ScheduleManager.getInstance(applicationContext)
                    val config = scheduleManager.get(scheduleId)
                    return config?.toString() ?: JSONObject().put("error", "Schedule not found").toString()
                }
                "update" -> {
                    val jsonStr = parts.getOrNull(3) ?: return null
                    val json = JSONObject(jsonStr)
                    val scheduleId = json.getString("id")
                    val config = json.getJSONObject("config")
                    
                    val scheduleManager = ScheduleManager.getInstance(applicationContext)
                    scheduleManager.update(scheduleId, config)
                    return JSONObject().put("success", true).toString()
                }
                "add" -> {
                    val jsonStr = parts.getOrNull(3) ?: return null
                    val config = JSONObject(jsonStr)
                    
                    val scheduleManager = ScheduleManager.getInstance(applicationContext)
                    val id = scheduleManager.add(config)
                    return JSONObject().put("id", id).toString()
                }
                "delete" -> {
                    val scheduleId = parts.getOrNull(3) ?: return null
                    
                    val scheduleManager = ScheduleManager.getInstance(applicationContext)
                    scheduleManager.delete(scheduleId)
                    return JSONObject().put("success", true).toString()
                }
                "list" -> {
                    val scheduleManager = ScheduleManager.getInstance(applicationContext)
                    val schedules = scheduleManager.list()
                    val result = org.json.JSONArray().apply {
                        schedules.forEach { config ->
                            put(config)
                        }
                    }
                    return result.toString()
                }
                else -> return null
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to handle schedule prompt: $message", e)
            return JSONObject().put("error", e.message).toString()
        }
    }
    
    /**
     * 处理任务相关的 prompt
     */
    private fun handleTaskPrompt(taskId: String, message: String): Boolean {
        try {
            val parts = message.split(":", limit = 3)
            if (parts.size < 3 || parts[0] != "task") {
                return false
            }
            
            val action = parts[1]
            
            if (action !in listOf("progress", "complete", "fail")) {
                return false
            }
            
            val jsonStr = parts[2]
            val json = JSONObject(jsonStr)
            
            when (action) {
                "progress" -> {
                    val percent = json.optInt("percent", 0)
                    val msg = json.optString("message")
                    onProgress(taskId, percent, msg)
                }
                "complete" -> {
                    val title = json.optString("title")
                    val msg = json.optString("message")
                    val detailUrl = json.optString("detailUrl")
                    onComplete(taskId, title, msg, detailUrl)
                }
                "fail" -> {
                    val error = json.optString("error")
                    onFail(taskId, error)
                }
            }
            return true
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to handle task prompt: $message", e)
            return false
        }
    }
    
    /**
     * 任务进度更新
     */
    private fun onProgress(taskId: String, percent: Int, message: String?) {
        GlobalScope.launch {
            val task = store.get(taskId)
            if (task?.status == "cancelled") {
                Logger.i(TAG, "Task $taskId was cancelled, ignoring progress update")
                return@launch
            }
            
            store.updateProgress(taskId, percent, message)
            resetTimeout(taskId)
            
            // 更新前台通知，显示进度
            updateProgressNotification(taskId, percent, message)
        }
    }
    
    /**
     * 任务完成
     */
    private fun onComplete(taskId: String, title: String, message: String, detailUrl: String?) {
        GlobalScope.launch {
            val task = store.get(taskId)
            if (task?.status == "cancelled") {
                Logger.i(TAG, "Task $taskId was cancelled, ignoring completion")
                cleanup()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return@launch
            }
            
            // 先停止前台服务，移除进度通知
            stopForeground(STOP_FOREGROUND_REMOVE)
            
            // 更新任务状态并发送完成通知
            store.markCompleted(taskId, title, message, detailUrl)
            notifier.notify(taskId, title, message, detailUrl)
            
            // 清理资源并停止服务
            cleanup()
            stopSelf()
        }
    }
    
    /**
     * 任务失败
     */
    private fun onFail(taskId: String, error: String) {
        GlobalScope.launch {
            val task = store.get(taskId)
            if (task?.status == "cancelled") {
                Logger.i(TAG, "Task $taskId was cancelled, ignoring failure")
                cleanup()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return@launch
            }
            
            store.markFailed(taskId, error)
            notifier.notifyError(taskId, error)
            cleanup()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }
    
    /**
     * 设置超时
     */
    private fun setTimeout(taskId: String, timeoutMs: Long = DEFAULT_TIMEOUT_MS) {
        cancelTimeout()
        lastProgressTime = System.currentTimeMillis()
        
        timeoutRunnable = Runnable {
            if (currentTaskId == taskId && currentSession != null) {
                Logger.w(TAG, "Task $taskId timeout")
                GlobalScope.launch {
                    store.markFailed(taskId, "Timeout")
                    notifier.notifyError(taskId, "任务超时")
                    cleanup()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        
        mainHandler.postDelayed(timeoutRunnable!!, timeoutMs)
        Logger.d(TAG, "Set timeout for task $taskId: ${timeoutMs / 1000}s")
    }
    
    /**
     * 取消超时
     */
    private fun cancelTimeout() {
        timeoutRunnable?.let {
            mainHandler.removeCallbacks(it)
            timeoutRunnable = null
        }
    }
    
    /**
     * 重置超时时间
     */
    private fun resetTimeout(taskId: String) {
        val now = System.currentTimeMillis()
        val elapsed = now - lastProgressTime
        
        if (elapsed > MAX_TIMEOUT_MS) {
            Logger.w(TAG, "Task $taskId exceeded max timeout (${elapsed / 1000}s), not resetting")
            return
        }
        
        setTimeout(taskId, DEFAULT_TIMEOUT_MS)
        Logger.d(TAG, "Reset timeout for task $taskId after progress update")
    }
    
    /**
     * 处理 sniffer:// 协议（参考 MainActivity）
     */
    private fun handleSnifferUri(uri: String) {
        try {
            val parsed = android.net.Uri.parse(uri)
            val host = parsed.host ?: return
            
            // 数据上报：sniffer://ws?data=...（后台任务中忽略）
            if (host == "ws") {
                return
            }
            
            // 控制命令由 SnifferManager 处理（已经包含完整的 start/stop 逻辑）
            val handled = snifferManager?.handleSnifferUri(uri) ?: false
            if (handled) {
                // 只发送简单的通知（参考 MainActivity）
                when (host) {
                    "start" -> {
                        val id = parsed.getQueryParameter("id") ?: ""
                        jsCallback("onSnifferResult", """{"action":"started","data":"$id"}""")
                    }
                    "stop" -> {
                        val id = parsed.getQueryParameter("id") ?: ""
                        jsCallback("onSnifferResult", """{"action":"stopped","data":"$id"}""")
                    }
                }
            }
        } catch (e: Exception) {
            jsCallback("onSnifferResult", """{"action":"error","data":"${e.message}"}""")
        }
    }
    
    /**
     * 通过 JavaScript 注入回调数据到页面
     */
    private fun jsCallback(fn: String, json: String) {
        currentSession?.let { session ->
            // 转义 JSON 字符串（参考 MainActivity）
            val escaped = json
                .replace("\\", "\\\\")
                .replace("\'", "\\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            
            val jsCode = when (fn) {
                "onSnifferData" -> "if(window.onSnifferData) window.onSnifferData(\'$escaped\')"
                "onSnifferResult" -> "if(window.onSnifferResult) window.onSnifferResult(\'$escaped\')"
                else -> null
            }
            jsCode?.let {
                mainHandler.post {
                    session.loadUri("javascript:$it")
                }
            }
        }
    }
    
    /**
     * 推送消息到 TypeScript 层（用于 KataGo 回调）
     */
    private fun pushToTS(session: GeckoSession, json: String) {
        try {
            val escaped = json
                .replace("\\", "\\\\")
                .replace("\'", "\\\'")
                .replace("\n", "\\n")
                .replace("\r", "")

            val js = "if(window.onKatagoResult)window.onKatagoResult(\'$escaped\')"
            mainHandler.post {
                session.loadUri("javascript:$js")
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to push to TS", e)
        }
    }
    
    /**
     * 清理资源
     */
    private fun cleanup() {
        GlobalScope.launch(Dispatchers.Main) {
            try {
                cancelTimeout()
                currentSession?.close()
                currentSession = null
                currentTaskId = null
                Logger.i(TAG, "Cleaned up")
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to cleanup", e)
            }
        }
    }
    
    /**
     * 创建通知渠道
     */
    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "后台任务",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "后台任务执行通知"
            setShowBadge(false)
        }
        
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }
    
    /**
     * 创建前台通知
     */
    private fun createForegroundNotification(taskId: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(getString(R.string.task_running_title))
            .setContentText(getString(R.string.task_running_message, taskId))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
    
    /**
     * 更新进度通知
     */
    private fun updateProgressNotification(taskId: String, percent: Int, message: String?) {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val contentText = if (message != null) {
            "$message ($percent%)"
        } else {
            getString(R.string.task_progress_message, percent)
        }
        
        val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(getString(R.string.task_running_title))
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(100, percent, false)
            .build()
        
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }
}
