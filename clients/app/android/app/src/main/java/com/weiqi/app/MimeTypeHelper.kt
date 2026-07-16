package com.weiqi.app

/**
 * MIME 类型工具类
 * 根据文件扩展名返回对应的 MIME 类型
 */
object MimeTypeHelper {
    
    private val MIME_TYPES = mapOf(
        "html" to "text/html",
        "htm" to "text/html",
        "css" to "text/css",
        "js" to "application/javascript",
        "json" to "application/json",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "gif" to "image/gif",
        "svg" to "image/svg+xml",
        "ico" to "image/x-icon",
        "woff" to "font/woff",
        "woff2" to "font/woff2",
        "ttf" to "font/ttf",
        "eot" to "application/vnd.ms-fontobject",
        "mp3" to "audio/mpeg",
        "mp4" to "video/mp4",
        "webp" to "image/webp",
        "webmanifest" to "application/manifest+json",
        "wasm" to "application/wasm",
        "gz" to "application/gzip"
    )

    /**
     * 根据文件名获取 MIME 类型
     * @param filename 文件名（包含扩展名）
     * @return MIME 类型字符串，未知类型返回 "application/octet-stream"
     */
    fun getMimeType(filename: String): String {
        val ext = filename.substringAfterLast('.', "").lowercase()
        return MIME_TYPES[ext] ?: "application/octet-stream"
    }
}
