package com.weiqi.app.sniffer

import org.json.JSONArray
import org.json.JSONObject

/**
 * WebSocket 事件数据类
 */
data class WSEvent(
    val type: String,      // open, send, receive, close, error
    val url: String,       // WebSocket URL
    val data: String?,     // 数据或null
    val timestamp: Long    // 时间戳
) {
    companion object {
        fun fromJson(obj: JSONObject): WSEvent {
            return WSEvent(
                type = obj.getString("t"),
                url = obj.getString("u"),
                data = obj.optString("d").takeIf { it.isNotEmpty() },
                timestamp = obj.getLong("ts")
            )
        }
    }

    fun toJson(): String {
        val obj = JSONObject().apply {
            put("t", type)
            put("u", url)
            put("d", data ?: JSONObject.NULL)
            put("ts", timestamp)
        }
        return obj.toString()
    }
}

/**
 * HTTP 事件数据类
 */
data class HTTPEvent(
    val type: String,           // http_request, http_response, http_error
    val url: String,            // 请求 URL
    val method: String? = null, // 请求方法（GET, POST 等）
    val status: Int? = null,    // 响应状态码
    val headers: Map<String, String>? = null, // 请求/响应头
    val body: String? = null,   // 请求/响应体
    val error: String? = null,  // 错误信息
    val timestamp: Long         // 时间戳
) {
    companion object {
        fun fromJson(obj: JSONObject): HTTPEvent {
            val headersMap = if (obj.has("d") && obj.getJSONObject("d").has("headers")) {
                val headersObj = obj.getJSONObject("d").getJSONObject("headers")
                val map = mutableMapOf<String, String>()
                val keys = headersObj.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    map[key] = headersObj.getString(key)
                }
                map
            } else null

            val dataObj = if (obj.has("d")) obj.getJSONObject("d") else null

            return HTTPEvent(
                type = obj.getString("t"),
                url = obj.getString("u"),
                method = dataObj?.optString("method"),
                status = dataObj?.optInt("status"),
                headers = headersMap,
                body = dataObj?.optString("body"),
                error = dataObj?.optString("error"),
                timestamp = obj.getLong("ts")
            )
        }
    }

    fun toJson(): String {
        val obj = JSONObject().apply {
            put("t", type)
            put("u", url)
            put("ts", timestamp)
            
            val dataObj = JSONObject().apply {
                method?.let { put("method", it) }
                status?.let { put("status", it) }
                headers?.let { 
                    val headersObj = JSONObject()
                    it.forEach { (k, v) -> headersObj.put(k, v) }
                    put("headers", headersObj)
                }
                body?.let { put("body", it) }
                error?.let { put("error", it) }
            }
            put("d", dataObj)
        }
        return obj.toString()
    }
}

/**
 * 抓包事件（联合类型）
 */
sealed class SnifferEvent {
    data class WS(val event: WSEvent) : SnifferEvent()
    data class HTTP(val event: HTTPEvent) : SnifferEvent()
    
    val timestamp: Long
        get() = when (this) {
            is WS -> event.timestamp
            is HTTP -> event.timestamp
        }
    
    val url: String
        get() = when (this) {
            is WS -> event.url
            is HTTP -> event.url
        }
}

/**
 * 抓包结果
 */
data class SnifferResult(
    val sessionId: String,
    val success: Boolean,
    val events: List<SnifferEvent>,
    val error: String? = null,
    val timing: SnifferTiming? = null
)

/**
 * 时间统计
 */
data class SnifferTiming(
    val start: Long,
    val end: Long,
    val duration: Long
)
