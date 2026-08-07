package com.weiqi.app.sniffer

import android.content.Context
import android.net.Uri
import com.weiqi.app.util.Logger
import org.mozilla.geckoview.GeckoRuntime

/**
 * SnifferManager - 抓包会话管理器
 *
 * 管理多个 SnifferSession，提供 start/stop/flush 接口
 * 每个 Activity/Service 持有独立实例，各自维护自己的 jsCallback
 * 线程安全：所有读写 sessions 的操作通过 synchronized(sessions) 保护
 */
class SnifferManager(
    private val context: Context,
    private val runtime: GeckoRuntime,
    private val jsCallback: ((String, String) -> Unit)? = null
) {
    companion object {
        private const val TAG = "SnifferManager"
    }

    private val sessions = mutableMapOf<String, SnifferSession>()

    /**
     * 启动抓包会话
     */
    fun start(
        id: String,
        url: String,
        timeoutMs: Long = 30000,
        onData: (List<SnifferEvent>) -> Unit = {},
        onResult: (SnifferResult) -> Unit = {}
    ): SnifferSession {
        // 停止已有同ID会话
        stop(id)

        val session = SnifferSession(
            id = id,
            targetUrl = url,
            runtime = runtime,
            context = context,
            onData = onData,
            onResult = { result ->
                synchronized(sessions) { sessions.remove(id) }
                onResult(result)
            },
            timeoutMs = timeoutMs
        )

        synchronized(sessions) {
            sessions[id] = session
        }
        session.start()

        Logger.i(TAG, "Started session [$id] -> $url")
        return session
    }

    /**
     * 停止指定会话
     */
    fun stop(id: String): SnifferResult? {
        val session: SnifferSession?
        synchronized(sessions) {
            session = sessions.remove(id)
        }
        if (session == null) return null

        val result = SnifferResult(
            sessionId = id,
            success = true,
            events = session.collectedEvents,
            timing = SnifferTiming(
                start = System.currentTimeMillis() - 1000,
                end = System.currentTimeMillis(),
                duration = 1000
            )
        )
        session.stop()
        Logger.i(TAG, "Stopped session [$id]")
        return result
    }

    /**
     * 停止所有运行中的会话
     */
    fun stopAll() {
        val runningIds = getRunningIds()
        runningIds.forEach { id ->
            stop(id)
        }
        Logger.i(TAG, "Stopped all sessions: ${runningIds.size}")
    }

    /**
     * 强制刷新数据（不停止会话）
     */
    fun flush(id: String) {
        val session: SnifferSession? = synchronized(sessions) { sessions[id] }
        session?.flush()
    }

    /**
     * 获取会话状态
     */
    fun getStatus(id: String): Map<String, Any> {
        val session: SnifferSession? = synchronized(sessions) { sessions[id] }
        return if (session != null) {
            mapOf(
                "id" to id,
                "running" to session.isRunning,
                "events" to session.collectedEvents.size
            )
        } else {
            mapOf("id" to id, "running" to false, "events" to 0)
        }
    }

    /**
     * 获取所有运行中的会话ID
     */
    fun getRunningIds(): List<String> = synchronized(sessions) {
        sessions.filter { it.value.isRunning }.keys.toList()
    }

    /**
     * 处理 sniffer:// 控制命令（仅保留 start/stop/flush/status）
     */
    fun handleSnifferUri(uri: String): Boolean {
        val parsed = Uri.parse(uri)
        val host = parsed.host ?: return false

        when (host) {
            "start" -> {
                val id = parsed.getQueryParameter("id") ?: return false
                val url = parsed.getQueryParameter("url") ?: return false
                val timeout = parsed.getQueryParameter("timeout")?.toLongOrNull() ?: 30000
                
                start(
                    id = id,
                    url = url,
                    timeoutMs = timeout,
                    onData = { events ->
                        jsCallback?.let { callback ->
                            val jsonArray = org.json.JSONArray()
                            events.forEach { event ->
                                val jsonObj = when (event) {
                                    is SnifferEvent.WS -> org.json.JSONObject(event.event.toJson())
                                    is SnifferEvent.HTTP -> org.json.JSONObject(event.event.toJson())
                                }
                                jsonArray.put(jsonObj)
                            }
                            callback("onSnifferData", jsonArray.toString())
                        }
                    },
                    onResult = { result ->
                        jsCallback?.let { callback ->
                            callback("onSnifferResult", """{"action":"completed","data":"${result.sessionId}","events":${result.events.size}}""")
                        }
                    }
                )
                return true
            }
            "stop" -> {
                val id = parsed.getQueryParameter("id") ?: return false
                stop(id)
                return true
            }
            "flush" -> {
                val id = parsed.getQueryParameter("id") ?: return false
                flush(id)
                return true
            }
            "status" -> {
                val id = parsed.getQueryParameter("id")
                if (id != null) {
                    val status = getStatus(id)
                    Logger.d(TAG, "Status: $status")
                }
                return true
            }
            else -> return false
        }
    }

    /**
     * 清理所有资源
     */
    fun cleanup() {
        Logger.i(TAG, "Cleaning up...")
        val ids: List<String> = synchronized(sessions) { sessions.keys.toList() }
        ids.forEach { stop(it) }
        synchronized(sessions) { sessions.clear() }
    }
}
