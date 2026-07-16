package com.weiqi.app

import android.app.Application
import com.weiqi.app.util.Logger
import com.weiqi.app.task.ScheduleManager
import com.weiqi.app.task.TaskManager
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

/**
 * WeiqiApp - Application 单例
 *
 * 管理 GeckoRuntime 全局实例（整个进程只允许一个）
 */
class WeiqiApp : Application() {

    companion object {
        private const val TAG = "WeiqiApp"
        
        @Volatile
        private var runtime: GeckoRuntime? = null

        /**
         * 获取全局 GeckoRuntime 实例
         *
         * 如果已存在则复用，否则创建新实例
         */
        fun getOrCreateRuntime(app: Application): GeckoRuntime {
            return runtime ?: synchronized(this) {
                runtime ?: createRuntime(app).also { runtime = it }
            }
        }

        private fun createRuntime(app: Application): GeckoRuntime {
            Logger.i(TAG, "Creating GeckoRuntime instance")

            val contentBlocking = ContentBlocking.Settings.Builder()
                .safeBrowsing(ContentBlocking.SafeBrowsing.NONE)
                .antiTracking(ContentBlocking.AntiTracking.NONE)
                .build()

            val runtimeSettings = GeckoRuntimeSettings.Builder()
                .consoleOutput(true)
                .contentBlocking(contentBlocking)
                .build()

            return GeckoRuntime.create(app, runtimeSettings)
        }
    }

    override fun onCreate() {
        super.onCreate()
        Logger.i(TAG, "Application onCreate")
        
        // 恢复所有定时计划调度
        restoreAllSchedules()
    }
    
    /**
     * 恢复所有定时计划调度
     * 
     * App 启动时，从 ScheduleManager 加载所有计划并重新入队 WorkManager
     */
    private fun restoreAllSchedules() {
        try {
            val scheduleManager = ScheduleManager.getInstance(this)
            val taskManager = TaskManager(this)
            
            val schedules = scheduleManager.list()
            Logger.i(TAG, "Restoring ${schedules.size} schedules")
            
            for (config in schedules) {
                val id = config.optString("id")
                if (id.isNotEmpty()) {
                    taskManager.schedulePeriodic(id, 15)
                }
            }
            
            Logger.i(TAG, "All schedules restored")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to restore schedules", e)
        }
    }
}
