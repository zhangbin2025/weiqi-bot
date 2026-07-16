package com.weiqi.app

import com.weiqi.app.BuildConfig

/**
 * 应用配置统一管理
 * 所有配置从 BuildConfig 读取，支持编译时注入
 */
object AppConfig {
    
    /** 本地服务器地址 */
    val localHost: String = BuildConfig.LOCAL_HOST
    
    /** 本地服务器端口 */
    val localPort: Int = BuildConfig.LOCAL_PORT
    
    /** 本地服务器完整 URL */
    val localServerUrl: String = "http://$localHost:$localPort"
    
    /** 首页 URL */
    val homeUrl: String = "$localServerUrl/index.html"
    
    /** 远程服务器地址 */
    val remoteBase: String = BuildConfig.REMOTE_BASE
    
    /** 版本检查接口 */
    val versionUrl: String = "$remoteBase${BuildConfig.VERSION_ENDPOINT}"
    
    /**
     * 构造本地页面 URL
     * @param path 相对路径，如 "index.html", "assistant/index.html"
     */
    fun localPageUrl(path: String): String {
        val normalizedPath = path.removePrefix("../").removePrefix("./")
        return if (normalizedPath.contains("://")) {
            normalizedPath
        } else {
            "$localServerUrl/$normalizedPath"
        }
    }
    
    /**
     * 构造远程资源 URL
     * @param path 相对路径
     */
    fun remoteUrl(path: String): String {
        return "$remoteBase/$path"
    }
}
