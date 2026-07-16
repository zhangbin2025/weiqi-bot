package com.weiqi.app.ui

import android.app.Activity
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import com.weiqi.app.R

/**
 * UIHelper - UI 显示辅助类
 *
 * 职责：
 * 1. 管理加载状态显示
 * 2. 管理错误提示
 * 3. 管理下载提示
 * 4. 格式化工具方法
 */
class UIHelper(private val activity: Activity) {
    
    private val progressBar: ProgressBar = activity.findViewById(R.id.progressBar)
    private val loadingText: TextView = activity.findViewById(R.id.loadingText)
    private val progressText: TextView = activity.findViewById(R.id.progressText)
    private val downloadHint: TextView = activity.findViewById(R.id.downloadHint)
    
    /**
     * 显示加载状态
     * 
     * @param message 加载消息
     * @param progress 进度（0-100，0表示不确定进度）
     */
    fun showLoading(message: String, progress: Int = 0) {
        activity.runOnUiThread {
            loadingText.text = message
            loadingText.visibility = View.VISIBLE
            
            if (progress > 0) {
                progressBar.isIndeterminate = false
                progressBar.progress = progress
                progressText.text = "$progress%"
                progressText.visibility = View.VISIBLE
            } else {
                progressBar.isIndeterminate = true
                progressText.visibility = View.GONE
            }
            
            progressBar.visibility = View.VISIBLE
        }
    }
    
    /**
     * 隐藏加载状态
     */
    fun hideLoading() {
        activity.runOnUiThread {
            progressBar.visibility = View.GONE
            loadingText.visibility = View.GONE
            progressText.visibility = View.GONE
        }
    }
    
    /**
     * 显示错误消息
     * 
     * @param message 错误消息
     */
    fun showError(message: String) {
        activity.runOnUiThread {
            loadingText.text = message
            loadingText.visibility = View.VISIBLE
            progressBar.visibility = View.GONE
            progressText.visibility = View.GONE
        }
    }
    
    private var downloadStartTime: Long = 0
    private var isDownloadHintShown: Boolean = false
    
    /**
     * 显示下载提示（带防抖）
     * 只在下载时间超过 1 秒时才显示提示
     * 
     * @param message 提示消息
     */
    fun showDownloadHint(message: String) {
        activity.runOnUiThread {
            // 记录开始时间
            if (!isDownloadHintShown) {
                downloadStartTime = System.currentTimeMillis()
                isDownloadHintShown = true
            }
            
            // 延迟显示（避免快速下载时闪烁）
            val elapsed = System.currentTimeMillis() - downloadStartTime
            if (elapsed >= 1000) {
                downloadHint.text = message
                downloadHint.visibility = View.VISIBLE
            }
        }
    }
    
    /**
     * 隐藏下载提示
     */
    fun hideDownloadHint() {
        activity.runOnUiThread {
            downloadHint.visibility = View.GONE
            isDownloadHintShown = false
            downloadStartTime = 0
        }
    }
    
    companion object {
        /**
         * 格式化文件大小
         * 
         * @param bytes 字节数
         * @return 格式化后的字符串（如 "1.5 MB"）
         */
        fun formatSize(bytes: Long): String {
            if (bytes < 1024) return "$bytes B"
            val kb = bytes / 1024.0
            if (kb < 1024) return "%.1f KB".format(kb)
            val mb = kb / 1024.0
            if (mb < 1024) return "%.1f MB".format(mb)
            val gb = mb / 1024.0
            return "%.1f GB".format(gb)
        }
    }
}
