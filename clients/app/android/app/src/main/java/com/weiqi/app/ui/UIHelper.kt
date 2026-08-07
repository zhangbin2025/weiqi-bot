package com.weiqi.app.ui

import android.app.Activity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.weiqi.app.R

/**
 * UIHelper - UI 显示辅助类
 */
class UIHelper(private val activity: Activity) {
    
    private val loadingOverlay: LinearLayout = activity.findViewById(R.id.loadingOverlay)
    private val progressBar: ProgressBar = activity.findViewById(R.id.progressBar)
    private val loadingText: TextView = activity.findViewById(R.id.loadingText)
    private val downloadHint: TextView = activity.findViewById(R.id.downloadHint)
    
    /**
     * 显示全屏加载界面
     * 
     * @param message 加载消息（如 "下载资源 (5/200)"）
     * @param progress 进度 0-100（0 表示不确定进度）
     */
    fun showLoading(message: String, progress: Int = 0) {
        activity.runOnUiThread {
            if (progress > 0) {
                loadingText.text = "$message  $progress%"
                progressBar.isIndeterminate = false
                progressBar.progress = progress
            } else {
                loadingText.text = message
                progressBar.isIndeterminate = true
            }
            
            loadingOverlay.visibility = View.VISIBLE
        }
    }
    
    /**
     * 隐藏全屏加载界面
     */
    fun hideLoading() {
        activity.runOnUiThread {
            loadingOverlay.visibility = View.GONE
        }
    }
    
    /**
     * 显示错误消息
     */
    fun showError(message: String) {
        activity.runOnUiThread {
            loadingText.text = message
            progressBar.visibility = View.GONE
            loadingOverlay.visibility = View.VISIBLE
        }
    }
    
    private var downloadStartTime: Long = 0
    private var isDownloadHintShown: Boolean = false
    
    fun showDownloadHint(message: String) {
        activity.runOnUiThread {
            if (!isDownloadHintShown) {
                downloadStartTime = System.currentTimeMillis()
                isDownloadHintShown = true
            }
            
            val elapsed = System.currentTimeMillis() - downloadStartTime
            if (elapsed >= 1000) {
                downloadHint.text = message
                downloadHint.visibility = View.VISIBLE
            }
        }
    }
    
    fun hideDownloadHint() {
        activity.runOnUiThread {
            downloadHint.visibility = View.GONE
            isDownloadHintShown = false
            downloadStartTime = 0
        }
    }
    
    companion object {
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
