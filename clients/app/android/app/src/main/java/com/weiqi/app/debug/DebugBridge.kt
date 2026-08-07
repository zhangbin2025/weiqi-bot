package com.weiqi.app.debug

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.StorageController

/**
 * DebugBridge - 调试桥接接口（极简版）
 *
 * 职责：只提供最基础的数据接口，不做额外处理
 * 所有方法通过 DebugBridgeHandler（prompt 协议）暴露给前端
 */
class DebugBridge(private val context: Context) {

    companion object {
        private const val TAG = "DebugBridge"
        private const val MAX_LOGS = 5000
        
        // 日志存储（最简单的 List）
        private val logs = mutableListOf<String>()
        
        // GeckoRuntime 引用（用于管理 GeckoView 存储）
        private var geckoRuntime: org.mozilla.geckoview.GeckoRuntime? = null
        
        /**
         * 设置 GeckoRuntime 引用
         */
        fun setGeckoRuntime(runtime: org.mozilla.geckoview.GeckoRuntime) {
            geckoRuntime = runtime
        }
        
        /**
         * 记录日志（全局方法）
         */
        fun log(level: String, tag: String, message: String) {
            synchronized(logs) {
                if (logs.size >= MAX_LOGS) {
                    logs.removeAt(0)
                }
                // 格式: timestamp|level|tag|message
                logs.add("${System.currentTimeMillis()}|$level|$tag|$message")
            }
            
            // 输出到 logcat
            when (level) {
                "ERROR" -> Log.e(tag, message)
                "WARN" -> Log.w(tag, message)
                "INFO" -> Log.i(tag, message)
                else -> Log.d(tag, message)
            }
        }
    }

    // ========== 日志接口 ==========
    
    fun getLogs(): String {
        synchronized(logs) {
            return JSONArray(logs).toString()
        }
    }
    
    fun clearLogs() {
        synchronized(logs) {
            logs.clear()
        }
    }

    // ========== 存储接口 ==========
    
    fun getFilesDir(): String {
        return context.filesDir.absolutePath
    }
    
    fun getCacheDir(): String {
        return context.cacheDir.absolutePath
    }
    
    fun getFileSize(path: String): Long {
        val file = File(path)
        return if (file.exists()) {
            if (file.isFile) file.length() else calculateDirSize(file)
        } else {
            0
        }
    }
    
    fun listFiles(path: String): String {
        val dir = File(path)
        if (!dir.exists() || !dir.isDirectory) {
            return "[]"
        }
        
        val files = dir.listFiles() ?: return "[]"
        val json = JSONArray()
        
        files.forEach { file ->
            json.put(JSONObject().apply {
                put("name", file.name)
                put("path", file.absolutePath)
                put("isDirectory", file.isDirectory)
                put("size", if (file.isFile) file.length() else 0)
                put("lastModified", file.lastModified())
            })
        }
        
        return json.toString()
    }
    
    fun deleteFile(path: String): Boolean {
        val file = File(path)
        return if (file.exists()) {
            file.deleteRecursively()
        } else {
            false
        }
    }

    // ========== 性能接口 ==========
    
    fun getMaxMemory(): Long {
        return Runtime.getRuntime().maxMemory()
    }
    
    fun getTotalMemory(): Long {
        return Runtime.getRuntime().totalMemory()
    }
    
    fun getFreeMemory(): Long {
        return Runtime.getRuntime().freeMemory()
    }
    
    fun getCurrentTime(): Long {
        return System.currentTimeMillis()
    }

    // ========== App 信息接口 ==========
    
    fun getAppVersion(): String {
        return try {
            val pm = context.packageManager
            val info = pm.getPackageInfo(context.packageName, 0)
            info.versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }
    
    fun getDeviceModel(): String {
        return android.os.Build.MODEL
    }
    
    fun getAndroidVersion(): String {
        return android.os.Build.VERSION.RELEASE
    }

    // ========== WebSocket 抓包接口（已废弃）==========
    
    fun getRunningSnifferSessions(): String {
        return "[]"
    }
    
    // ========== 存储管理接口 ==========
    
    fun clearCache(): Boolean {
        try {
            // 1. 清空应用缓存目录
            val cacheDir = context.cacheDir
            if (cacheDir.exists()) {
                cacheDir.listFiles()?.forEach { it.deleteRecursively() }
            }
            
            // 2. 清空 GeckoView 数据
            geckoRuntime?.storageController?.clearData(StorageController.ClearFlags.ALL)
            
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to clear cache: ${e.message}")
            return false
        }
    }
    
    fun getGeckoStorageSize(): Long {
        // GeckoView 没有直接提供获取存储大小的 API
        // 这里返回 0，因为 GeckoView 数据存储在应用缓存目录中
        // 已经在 getCacheDir 的统计中包含了
        return 0
    }

    // ========== 私有辅助方法 ==========
    
    private fun calculateDirSize(dir: File): Long {
        return dir.walkTopDown()
            .filter { it.isFile }
            .map { it.length() }
            .sum()
    }
}
