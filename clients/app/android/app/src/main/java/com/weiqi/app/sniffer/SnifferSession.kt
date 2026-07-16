package com.weiqi.app.sniffer

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.weiqi.app.util.Logger
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.*
import org.mozilla.geckoview.GeckoSession.ContentDelegate
import org.mozilla.geckoview.GeckoSession.PermissionDelegate
import org.mozilla.geckoview.GeckoSession.NavigationDelegate
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.atomic.AtomicReference

/**
 * SnifferSession - 单次抓包会话
 *
 * 关键点：
 *  1) WebExtension 通过 ensureBuiltIn 安装；句柄缓存到全局 AtomicReference，
 *     重复 start 不重复装。
 *  2) MessageDelegate 必须绑在 GeckoSession 的 WebExtensionController 上才能
 *     接收 content script 的 connectNative —— runtime/extension 级的
 *     setMessageDelegate 只覆盖 background script，对 CS 不生效。
 *  3) 注册顺序：session.open() → setMessageDelegate(...) → loadUri()。
 *     在 loadUri 之前注册，避免漏掉 content script 的首批消息。
 *  4) 全程在 main thread 串起来，避免 latch.await 阻塞 main 导致 ensureBuiltIn
 *     的异步回调永远跑不到。
 */
class SnifferSession(
    val id: String,
    private val targetUrl: String,
    private val runtime: GeckoRuntime,
    private val context: Context,
    private val onData: (List<SnifferEvent>) -> Unit,
    private val onResult: (SnifferResult) -> Unit,
    private val timeoutMs: Long = 30000
) {
    companion object {
        private const val TAG = "SnifferSession"
        private const val EXTENSION_ID = "ws-sniffer@weiqi.app"
        private const val EXTENSION_LOCATION = "resource://android/assets/ws-sniffer-ext/"
        private const val NATIVE_APP_ID = "browser"

        // 已安装的 WebExtension 句柄；进程内复用，不重复装。
        private val installedExtension = AtomicReference<WebExtension?>(null)
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var session: GeckoSession? = null
    private var timer: Timer? = null
    private val events = mutableListOf<SnifferEvent>()
    private var startTime: Long = 0

    @Volatile var isRunning = false; private set
    @Volatile private var stopped = false

    val collectedEvents: List<SnifferEvent>
        get() = synchronized(events) { events.toList() }

    fun start() {
        if (isRunning) {
            Logger.w(TAG, "[$id] Already running")
            return
        }
        startTime = System.currentTimeMillis()
        isRunning = true
        stopped = false

        // 启动超时定时器（独立于扩展安装/页面加载流程）
        timer = Timer().apply {
            schedule(object : TimerTask() {
                override fun run() {
                    Logger.w(TAG, "[$id] Timeout after ${timeoutMs}ms")
                    stop(timeout = true)
                }
            }, timeoutMs)
        }

        // 在 main thread 串行执行：安装扩展 → 开 session → 注册 delegate → loadUri
        mainHandler.post { ensureExtensionAndLoad() }
    }

    private fun ensureExtensionAndLoad() {
        if (!isRunning) return
        val cached = installedExtension.get()
        if (cached != null) {
            openSessionAndLoad(cached)
            return
        }

        try {
            runtime.webExtensionController
                .ensureBuiltIn(EXTENSION_LOCATION, EXTENSION_ID)
                .accept(
                    { ext ->
                        if (ext == null) {
                            Logger.e(TAG, "[$id] ensureBuiltIn returned null")
                            failStart("extension_null")
                            return@accept
                        }
                        installedExtension.compareAndSet(null, ext)
                        Logger.i(TAG, "[$id] WebExtension ready: ${ext.id}")
                        openSessionAndLoad(installedExtension.get()!!)
                    },
                    { e ->
                        Logger.e(TAG, "[$id] ensureBuiltIn failed", e)
                        failStart("ensure_failed:${e?.message}")
                    }
                )
        } catch (e: Exception) {
            Logger.e(TAG, "[$id] ensureBuiltIn threw", e)
            failStart("ensure_threw:${e.message}")
        }
    }

    private fun openSessionAndLoad(ext: WebExtension) {
        if (!isRunning) return
        try {
            // 创建私有会话（自动隔离数据，会话结束后自动清理）
            val settings = GeckoSessionSettings.Builder()
                .usePrivateMode(true)           // 私有模式，自动隔离数据
                .useTrackingProtection(true)    // 启用跟踪保护
                .build()
            
            val s = GeckoSession(settings)
            session = s
            
            s.open(runtime)

            // 添加 ContentDelegate 消除 GeckoView 内部警告
            s.contentDelegate = object : ContentDelegate {
                override fun onTitleChange(session: GeckoSession, title: String?) {}
                override fun onPreviewImage(session: GeckoSession, previewImageUrl: String) {}
                override fun onContextMenu(session: GeckoSession, screenX: Int, screenY: Int, element: ContentDelegate.ContextElement) {}
                override fun onCrash(session: GeckoSession) {
                    Logger.e(TAG, "[$id] Session crashed")
                }
                override fun onKill(session: GeckoSession) {
                    Logger.e(TAG, "[$id] Session killed")
                }
                override fun onFirstComposite(session: GeckoSession) {}
                override fun onFirstContentfulPaint(session: GeckoSession) {}
            }
            
            // 添加 PermissionDelegate 消除权限警告
            s.permissionDelegate = object : PermissionDelegate {
                override fun onAndroidPermissionsRequest(
                    session: GeckoSession,
                    permissions: Array<String>?,
                    callback: PermissionDelegate.Callback
                ) {
                    // 第三方页面权限请求，自动拒绝
                    callback.reject()
                }
                
                override fun onContentPermissionRequest(
                    session: GeckoSession,
                    perm: PermissionDelegate.ContentPermission
                ): GeckoResult<Int>? {
                    // 第三方页面内容权限请求，自动拒绝
                    return GeckoResult.fromValue(PermissionDelegate.ContentPermission.VALUE_DENY)
                }
                
                override fun onMediaPermissionRequest(
                    session: GeckoSession,
                    uri: String,
                    video: Array<PermissionDelegate.MediaSource>?,
                    audio: Array<PermissionDelegate.MediaSource>?,
                    callback: PermissionDelegate.MediaCallback
                ) {
                    // 第三方页面媒体权限请求，自动拒绝
                    callback.reject()
                }
            }

            // MessageDelegate 必须绑在该 session 的 WebExtensionController 上，
            // 且必须在 loadUri 之前注册，避免漏掉 content script 的首批消息。
            s.webExtensionController.setMessageDelegate(
                ext,
                createSessionMessageDelegate(),
                NATIVE_APP_ID
            )
            Logger.i(TAG, "[$id] MessageDelegate attached")

            s.loadUri(targetUrl)
            Logger.i(TAG, "[$id] Loading: $targetUrl")
        } catch (e: Exception) {
            Logger.e(TAG, "[$id] openSessionAndLoad failed", e)
            failStart("open_failed:${e.message}")
        }
    }

    private fun failStart(reason: String) {
        // 已在 main thread；直接清理 + 回调失败。
        if (stopped) return
        stopped = true
        isRunning = false
        timer?.cancel(); timer = null
        session?.let { s ->
            try { s.close() } catch (_: Exception) {}
        }
        session = null
        onResult(SnifferResult(id, false, emptyList(), reason))
    }

    fun stop(timeout: Boolean = false) {
        if (stopped) return
        synchronized(this) {
            if (stopped) return
            stopped = true
        }
        isRunning = false
        
        // 取消定时器并清空引用
        timer?.cancel()
        timer = null

        val endTime = System.currentTimeMillis()
        val duration = endTime - startTime

        mainHandler.post {
            session?.let { s ->
                try { s.close() } catch (e: Exception) {
                    Logger.e(TAG, "[$id] Error closing session", e)
                }
            }
            session = null
        }

        // 清空事件列表，避免内存泄漏
        val snapshot = synchronized(events) {
            events.toList().also { events.clear() }
        }
        
        val result = SnifferResult(
            sessionId = id,
            success = !timeout,
            events = snapshot,
            error = if (timeout) "timeout" else null,
            timing = SnifferTiming(startTime, endTime, duration)
        )

        Logger.i(TAG, "[$id] Stopped: ${snapshot.size} events, ${duration}ms")
        onResult(result)
    }

    fun flush() {
        if (!isRunning) return
        val snapshot = synchronized(events) { events.toList() }
        if (snapshot.isNotEmpty()) onData(snapshot)
    }

    private fun createSessionMessageDelegate(): WebExtension.MessageDelegate {
        return object : WebExtension.MessageDelegate {
            override fun onMessage(
                nativeApp: String,
                message: Any,
                sender: WebExtension.MessageSender
            ): GeckoResult<Any>? {
                handleNativeMessage(message)
                return null
            }

            override fun onConnect(port: WebExtension.Port) {
                Logger.i(TAG, "[$id] Port connected: ${port.name}")
                port.setDelegate(object : WebExtension.PortDelegate {
                    override fun onPortMessage(message: Any, p: WebExtension.Port) {
                        handleNativeMessage(message)
                    }

                    override fun onDisconnect(p: WebExtension.Port) {
                        Logger.i(TAG, "[$id] Port disconnected")
                    }
                })
            }
        }
    }

    private fun handleNativeMessage(message: Any) {
        if (message !is JSONObject) return
        try {
            when {
                message.has("wsEvents") -> handleEvents(message.getJSONArray("wsEvents"))
                message.optString("type") == "flush" -> flush()
            }
        } catch (e: Exception) {
            Logger.e(TAG, "[$id] Error handling message", e)
        }
    }

    private fun handleEvents(eventsArray: JSONArray) {
        val newEvents = ArrayList<SnifferEvent>(eventsArray.length())
        for (i in 0 until eventsArray.length()) {
            try {
                val eventObj = eventsArray.getJSONObject(i)
                val eventType = eventObj.getString("t")
                
                // 根据事件类型分发到不同的处理器
                val event = when {
                    // WebSocket 事件
                    eventType.startsWith("ws_") || 
                    eventType == "open" || 
                    eventType == "send" || 
                    eventType == "receive" || 
                    eventType == "close" || 
                    eventType == "error" -> {
                        SnifferEvent.WS(WSEvent.fromJson(eventObj))
                    }
                    // HTTP 事件
                    eventType.startsWith("http_") -> {
                        SnifferEvent.HTTP(HTTPEvent.fromJson(eventObj))
                    }
                    // 未知事件类型，跳过
                    else -> {
                        Logger.w(TAG, "[$id] Unknown event type: $eventType")
                        continue
                    }
                }
                newEvents.add(event)
            } catch (e: Exception) {
                Logger.w(TAG, "[$id] skip malformed event", e)
            }
        }
        if (newEvents.isEmpty()) return

        val total = synchronized(events) {
            events.addAll(newEvents)
            events.size
        }
        try {
            onData(newEvents)
        } catch (e: Exception) {
            Logger.e(TAG, "[$id] onData callback threw", e)
        }
        Logger.i(TAG, "[$id] Received ${newEvents.size} events, total: $total")
    }
}
