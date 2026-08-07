package com.weiqi.app.task

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.weiqi.app.MainActivity
import com.weiqi.app.R
import com.weiqi.app.util.Logger

/**
 * TaskNotifier - 任务通知管理
 *
 * 职责：
 * - 发送任务完成通知
 * - 点击通知打开 Assistant 对话
 */
class TaskNotifier(private val context: Context) {
    
    companion object {
        private const val TAG = "TaskNotifier"
        private const val CHANNEL_ID = "task_channel"
        private const val CHANNEL_NAME = "后台任务"
        private const val CHANNEL_DESC = "后台任务完成通知"
    }
    
    init {
        createNotificationChannel()
    }
    
    /**
     * 创建通知渠道（Android 8.0+）
     */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH  // 高重要性，会弹出横幅（像微信那样）
            ).apply {
                description = CHANNEL_DESC
                enableLights(true)
                enableVibration(true)
            }
            
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
    
    /**
     * 发送任务完成通知
     *
     * @param taskId 任务 ID
     * @param title 通知标题（如"查询完成"）
     * @param message 通知内容（如"找到棋手马天放"）
     * @param detailUrl 详情链接（如"/player/detail.html?id=xxx"）
     */
    fun notify(taskId: String, title: String, message: String, detailUrl: String?) {
        // 判断是否需要发送通知
        if (!shouldSendNotification(taskId)) {
            Logger.i(TAG, "Skip notification: user is on assistant page")
            return
        }
        
        // 创建点击通知的 Intent
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("openAssistant", true)
            putExtra("taskId", taskId)
            putExtra("detailUrl", detailUrl)
        }
        
        val pendingIntent = PendingIntent.getActivity(
            context,
            taskId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        // 构建通知
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)  // 点击后自动取消
            .setPriority(NotificationCompat.PRIORITY_HIGH)  // 高优先级，确保弹出横幅
            .setDefaults(NotificationCompat.DEFAULT_ALL)  // 默认声音、震动、灯光
            .build()
        
        // 发送通知
        try {
            NotificationManagerCompat.from(context).notify(taskId.hashCode(), notification)
            Logger.i(TAG, "Sent notification for task $taskId: $title - $message")
        } catch (e: SecurityException) {
            // Android 13+ 需要通知权限
            Logger.e(TAG, "Failed to send notification (missing permission?)", e)
        }
    }
    
    /**
     * 判断是否需要发送通知
     * 
     * 返回 true 表示需要发送通知，false 表示不发送
     */
    private fun shouldSendNotification(taskId: String): Boolean {
        // 定时任务（ID 以 "schedule_" 开头）始终发送通知
        // 因为定时任务是在隐藏 session 中执行的，用户没有发起对话
        if (taskId.startsWith("schedule_")) {
            Logger.i(TAG, "Schedule task completed, always send notification")
            return true
        }
        
        // 一次性任务：使用 AppStateManager 判断
        // 如果用户在助手页面，消息块会自动更新，不需要通知
        return com.weiqi.app.AppStateManager.shouldSendNotification()
    }
    
    /**
     * 发送任务失败通知
     */
    fun notifyError(taskId: String, error: String) {
        notify(taskId, "任务失败", error, null)
    }
}
