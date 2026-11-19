package com.weiqi.app

import com.weiqi.app.util.Logger
import fi.iki.elonen.NanoHTTPD
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
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
        // POST 请求体一律按原始字节透传，绝不经过 String 解码。
        // 2026-11-19 修复：NanoHTTPD 2.3.1 的 parseBody(files) 对 application/json（前端
        // 发的 Content-Type 不带 charset）会用 ContentType.getEncoding()=US-ASCII 把 UTF-8
        // 字节解成 String 塞进 files["postData"]，再由 OkHttp 按 UTF-8 重编码 —— 中文全部
        // 变成 U+FFFD，但 JSON 外形仍合法（不报 400），模型于是丢了「深圳天气」这类当前句、
        // 只剩 ASCII 的工具名/域名/示例，产生「先读 prefs、按示例城市凑数」的幻觉。
        // 桌面端是 req.pipe(proxyReq) 字节透传，纯 Web 走 Worker fetch 透传，都不经此坑。
        var postBodyBytes: ByteArray? = null
        var postBodyText: String? = null  // 仅供 x-www-form-urlencoded 回退重建（本就是 ASCII 表单）
        Logger.i(TAG, "Proxy >> $method $targetUrl")

        return try {
            if (session.method == NanoHTTPD.Method.POST) {
                if (isRawBodyContentType(session.headers?.get("content-type"))) {
                    // 原始字节路径：覆盖 application/json 等一切非表单类型
                    val raw = readRawPostBody(session)
                    postBodyBytes = raw
                    Logger.d(TAG, "Proxy: POST raw bytes = ${raw.size}")
                } else {
                    // 表单路径：仍需 parseBody 解析 parms，再按 UTF-8 重建表单串
                    val files = mutableMapOf<String, String>()
                    session.parseBody(files)
                    postBodyText = buildPostData(session.parms, session.headers?.get("content-type"))
                    Logger.d(TAG, "Proxy: POST params = ${session.parms.filterKeys { it != "url" }}")
                }
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

            // 透传自定义签名头（如 AppKey, CheckSum, accesstoken 等）
            val passthroughHeaders = listOf(
                "appkey", "checksum", "accesstoken", "nonce", "curtime",
                "timestamp", "usertoken", "version", "platform", "uuid",
                "accept", "accept-language", "authorization"
            )
            for (h in passthroughHeaders) {
                val value = session.headers?.get(h)
                if (!value.isNullOrEmpty()) {
                    requestBuilder.header(h, value)
                }
            }
            
            // 透传 Origin
            val origin = session.headers?.get("origin")
            if (!origin.isNullOrEmpty()) {
                requestBuilder.header("Origin", origin)
            }

            // 透传 POST 请求体：字节优先（application/json 等），表单走文本重建
            if (session.method == NanoHTTPD.Method.POST) {
                val mediaType = (contentType ?: "application/x-www-form-urlencoded").toMediaType()
                val body = if (postBodyBytes != null) {
                    // byte[] 重载：OkHttp 直接写原始字节，不再做任何字符集转换
                    postBodyBytes.toRequestBody(mediaType)
                } else {
                    (postBodyText ?: "").toRequestBody(mediaType)
                }
                Logger.d(TAG, "Proxy: POST body = ${if (postBodyBytes != null) postBodyBytes!!.size.toString() + " bytes (raw)" else (postBodyText ?: "").take(100)}")
                requestBuilder.post(body)
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
     * 判断该 Content-Type 是否应按「原始字节」透传。
     *
     * 依据（2026-11-19，反编译 NanoHTTPD 2.3.1 实测）：parseBody(files) 只在
     * `application/x-www-form-urlencoded` 分支里把表单解进 parms；其它类型（含
     * application/json）走 `new String(bytes, ContentType.getEncoding()).trim()` →
     * files["postData"]，而 getEncoding() 在无 charset 时是 US-ASCII，会毁掉 UTF-8 中文。
     * 因此除表单外一律读原始字节，不经过 String。multipart 由 NanoHTTPD 单独分支处理，
     * 本项目前端不用，也归入字节路径以免重编码。
     */
    private fun isRawBodyContentType(contentType: String?): Boolean {
        val ct = contentType?.lowercase()?.trim() ?: return true
        return !ct.startsWith("application/x-www-form-urlencoded")
    }

    /**
     * 按 Content-Length 从 session.getInputStream() 读出 POST 请求体的原始字节。
     *
     * NanoHTTPD 的 HTTPSession.execute() 在解析完 header 后 reset() 回 mark 并
     * skip(splitbyte)，此时 getInputStream() 的位置正是 body 起点（反编译确认）。
     * 且 parms["url"] / headers 在 execute() 阶段已解析好，不依赖 parseBody()，
     * 因此本读法不会丢代理目标地址 / 头。没有 Content-Length（分块）时退化为读到 EOF。
     */
    private fun readRawPostBody(session: NanoHTTPD.IHTTPSession): ByteArray {
        val headerValue = session.headers?.get("content-length")?.trim()
        val declared = headerValue?.toLongOrNull()
        val input: InputStream = session.getInputStream()
        val out = ByteArrayOutputStream()
        if (declared != null && declared > 0 && declared <= Int.MAX_VALUE) {
            val buf = ByteArray(declared.toInt())
            var off = 0
            while (off < buf.size) {
                val n = input.read(buf, off, buf.size - off)
                if (n < 0) break
                off += n
            }
            out.write(buf, 0, off)
        } else {
            val buf = ByteArray(512)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
            }
        }
        return out.toByteArray()
    }

    /**
     * 构造 POST 请求体
     * @param parms NanoHTTPD 解析的参数（包含 URL 查询参数和 POST 表单数据）
     * @param contentType Content-Type 头
     * @return 请求体字符串
     */
    private fun buildPostData(parms: Map<String, String>?, contentType: String?): String {
        if (parms == null) return ""
        
        // 对于 application/json，应该在外部使用 postBody，这里返回空字符串
        if (contentType?.contains("application/json") == true) {
            return ""
        }
        
        // 对于 application/x-www-form-urlencoded，从 parms 中排除 "url" 参数，重新构造请求体
        if (contentType?.contains("application/x-www-form-urlencoded") == true) {
            return parms
                .filterKeys { it != "url" }  // 排除代理路由的 url 参数
                .entries
                .joinToString("&") { (key, value) ->
                    "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
                }
        }
        
        return ""
    }
}
