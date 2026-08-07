package com.weiqi.app.util

import android.util.Log
import com.weiqi.app.debug.DebugBridge

/**
 * 日志工具类
 * 
 * 统一日志输出：
 * 1. 输出到 Logcat（方便开发调试）
 * 2. 输出到 DebugBridge（方便调试页面查看）
 */
object Logger {
    
    fun d(tag: String, message: String) {
        DebugBridge.log("DEBUG", tag, message)
    }
    
    fun i(tag: String, message: String) {
        DebugBridge.log("INFO", tag, message)
    }
    
    fun w(tag: String, message: String, throwable: Throwable? = null) {
        val fullMessage = if (throwable != null) {
            "$message: ${throwable.message}"
        } else {
            message
        }
        DebugBridge.log("WARN", tag, fullMessage)
    }
    
    fun e(tag: String, message: String, throwable: Throwable? = null) {
        val fullMessage = if (throwable != null) {
            "$message: ${throwable.message}"
        } else {
            message
        }
        DebugBridge.log("ERROR", tag, fullMessage)
    }
}
