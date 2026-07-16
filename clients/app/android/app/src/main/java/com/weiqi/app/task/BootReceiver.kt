package com.weiqi.app.task

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.weiqi.app.util.Logger

/**
 * BootReceiver - 监听系统启动事件
 *
 * 手机重启后，恢复所有定时计划调度
 */
class BootReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "BootReceiver"
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Logger.i(TAG, "Boot completed, restoring schedules")
            
            // 恢复所有定时计划调度
            try {
                val scheduleManager = ScheduleManager.getInstance(context)
                val taskManager = TaskManager(context)
                
                val schedules = scheduleManager.list()
                Logger.i(TAG, "Restoring ${schedules.size} schedules")
                
                for (config in schedules) {
                    val id = config.optString("id")
                    if (id.isNotEmpty()) {
                        taskManager.schedulePeriodic(id, 15)
                    }
                }
                
                Logger.i(TAG, "All schedules restored after boot")
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to restore schedules after boot", e)
            }
        }
    }
}
