package com.weiqi.app

import com.weiqi.app.util.Logger
import fi.iki.elonen.NanoHTTPD
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InputStream
import java.net.URLEncoder

/**
 * 反向代理处理器
 * 处理 /proxy 路由，转发 App 内前端的跨域请求
 * Cookie 由 OkHttp 的 CookieJar 自动管理，支持跨请求会话保持
 */
class ProxyHandler(
    private val client: OkHttpClient,
    private val cacheDir: java.io.File? = null
) {
    
    /**
     * 自定义响应类，持有 OkHttp Response 引用
     * 在 NanoHTTPD 发送完响应后自动关闭 OkHttp Response
     */
    private class ProxyResponse(
        status: NanoHTTPD.Response.Status,
        contentType: String,
        inputStream: InputStream,
        contentLength: Long,
        private val okHttpResponse: okhttp3.Response
    ) : NanoHTTPD.Response(status, contentType, inputStream, contentLength) {
        
        override fun close() {
            super.close()  // 关闭 InputStream
            okHttpResponse.close()  // 关闭 OkHttp Response
            Logger.d(TAG, "ProxyResponse closed, OkHttp Response released")
        }
    }
    
    companion object {
        private const val TAG = "ProxyHandler"
    }

    /** 按需下载回调（用于显示进度） */
    var onDemandCallback: AssetServer.OnDemandCallback? = null

    /**
     * 处理 /proxy 反向代理请求
     *
     * 格式: GET /proxy?url=<encoded_url>
     * App 内前端通过此路由转发请求，绕过浏览器 CORS 限制
     * 
     * 使用 use 自动关闭 Response
     * 对于大响应体，使用流式传输避免 OOM
     */
    @Suppress("DEPRECATION")
    fun handleProxy(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        val targetUrl = session.parms["url"]
        if (targetUrl.isNullOrEmpty()) {
            Logger.w(TAG, "Proxy: missing url parameter from ${session.uri}")
            return NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST, "application/json",
                "{\"error\":\"missing url parameter\"}"
            )
        }

        val startTime = System.currentTimeMillis()
        val method = session.method.name
        Logger.i(TAG, "Proxy >> $method $targetUrl")

        return try {
            // 对于 POST 请求，需要解析请求体
            // NanoHTTPD 不会自动解析 POST 数据到 session.parms，需要调用 parseBody
            if (session.method == NanoHTTPD.Method.POST) {
                val files = mutableMapOf<String, String>()
                session.parseBody(files)
                Logger.d(TAG, "Proxy: POST params = ${session.parms.filterKeys { it != "url" }}")
            }
            
            val requestBuilder = Request.Builder().url(targetUrl)

            // 透传 User-Agent 和 Referer
            // 支持两种方式：
            // 1. 自定义头- 绕过浏览器限制，优先级更高
            // 2. 标准头 - 直接透传（浏览器自动添加）
            // 注意：必须优先读取自定义头，因为浏览器总是会自动添加标准头
            val userAgent = session.headers?.get("x-user-agent")
                ?: session.headers?.get("user-agent")
            if (!userAgent.isNullOrEmpty()) {
                requestBuilder.header("User-Agent", userAgent)
                Logger.d(TAG, "Proxy: User-Agent=${userAgent.take(50)}...")
            }

            val referer = session.headers?.get("x-referer")
                ?: session.headers?.get("referer")
            if (!referer.isNullOrEmpty()) {
                requestBuilder.header("Referer", referer)
                Logger.d(TAG, "Proxy: Referer=$referer")
            }
            
            // 透传 Cookie（上层手动管理时需要）
            // 支持两种方式：
            // 1. cookie 头 - 直接透传（浏览器不允讲手动设置）
            // 2. x-cookie 头 - 自定义头，绕过浏览器限制
            val cookie = session.headers?.get("cookie")
            val xCookie = session.headers?.get("x-cookie")
            val finalCookie = cookie ?: xCookie
            if (!finalCookie.isNullOrEmpty()) {
                requestBuilder.header("Cookie", finalCookie)
                Logger.d(TAG, "Proxy: Cookie=${finalCookie.take(50)}...")
            }
            
            // 透传 Content-Type
            val contentType = session.headers?.get("content-type")
            if (!contentType.isNullOrEmpty()) {
                requestBuilder.header("Content-Type", contentType)
            }
            
            // 透传 Origin
            val origin = session.headers?.get("origin")
            if (!origin.isNullOrEmpty()) {
                requestBuilder.header("Origin", origin)
            }

            // 透传 POST 请求体
            if (session.method == NanoHTTPD.Method.POST) {
                // NanoHTTPD 对于 application/x-www-form-urlencoded 会自动解析到 session.parms
                // 需要从 parms 中排除 "url" 参数（这是代理路由的参数），然后重新构造请求体
                val mediaType = (contentType ?: "application/x-www-form-urlencoded").toMediaType()
                val postData = buildPostData(session.parms, contentType)
                Logger.d(TAG, "Proxy: POST data = ${postData.take(100)}")
                requestBuilder.post(postData.toRequestBody(mediaType))
            }

            // 执行请求（不使用 use，由 ProxyResponse 在关闭时释放资源）
            val response = client.newCall(requestBuilder.build()).execute()
            val elapsed = System.currentTimeMillis() - startTime
            val responseContentType = response.header("Content-Type", "application/json") ?: "application/json"
            val contentLength = response.body?.contentLength() ?: -1L
            var inputStream = response.body?.byteStream()
            
            Logger.i(TAG, "Proxy << $method $targetUrl -> ${response.code} (${elapsed}ms, ${if (contentLength > 0) "$contentLength bytes" else "chunked"})")

            // 使用 ProxyResponse 创建响应（流式传输，支持大文件）
            val proxyResponse = if (inputStream != null && contentLength > 0) {
                // 已知长度的响应
                ProxyResponse(
                    NanoHTTPD.Response.Status.lookup(response.code),
                    responseContentType,
                    inputStream,
                    contentLength,
                    response
                )
            } else if (inputStream != null) {
                // 未知长度（分块传输）
                ProxyResponse(
                    NanoHTTPD.Response.Status.lookup(response.code),
                    responseContentType,
                    inputStream,
                    -1L,
                    response
                )
            } else {
                // 无响应体
                ProxyResponse(
                    NanoHTTPD.Response.Status.lookup(response.code),
                    responseContentType,
                    java.io.ByteArrayInputStream(ByteArray(0)),
                    0L,
                    response
                )
            }
            
            proxyResponse.apply {
                    addHeader("Access-Control-Allow-Origin", "*")
                    addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    addHeader("Access-Control-Allow-Headers", "*")
                    addHeader("Access-Control-Expose-Headers", "X-Set-Cookie")

                    // 透传 Set-Cookie（让前端也能看到）
                    // 注意：Set-Cookie 是 CORS 禁止暴露的头，需要改名为 X-Set-Cookie
                    val setCookies = response.headers("Set-Cookie")
                    for (setCookie in setCookies) {
                        addHeader("X-Set-Cookie", setCookie)
                    }
                }
        } catch (e: Exception) {
            val elapsed = System.currentTimeMillis() - startTime
            Logger.e(TAG, "Proxy !! $method $targetUrl FAILED (${elapsed}ms): ${e.message}")
            NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.INTERNAL_ERROR, "application/json",
                "{\"error\":\"proxy_failed\"}"
            )
        }
    }
    
    /**
     * 构造 POST 请求体
     * @param parms NanoHTTPD 解析的参数（包含 URL 查询参数和 POST 表单数据）
     * @param contentType Content-Type 头
     * @return 请求体字符串
     */
    private fun buildPostData(parms: Map<String, String>?, contentType: String?): String {
        if (parms == null) return ""
        
        // 对于 application/x-www-form-urlencoded，从 parms 中排除 "url" 参数，重新构造请求体
        if (contentType?.contains("application/x-www-form-urlencoded") == true) {
            return parms
                .filterKeys { it != "url" }  // 排除代理路由的 url 参数
                .entries
                .joinToString("&") { (key, value) ->
                    "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
                }
        }
        
        // 对于其他类型（如 application/json），尝试从 parms 获取 postData 字段
        return parms["postData"] ?: ""
    }
}
