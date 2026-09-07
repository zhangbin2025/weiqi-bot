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
        
        @Volatile
        private var assetServer: AssetServer? = null
        
        /**
         * 获取或创建 AssetServer 单例
         */
        fun getOrCreateAssetServer(app: Application): AssetServer {
            return assetServer ?: synchronized(this) {
                assetServer ?: AssetServer(app).also { 
                    assetServer = it
                    it.start()
                    Logger.i(TAG, "AssetServer started on port ${AssetServer.DEFAULT_PORT}")
                }
            }
        }
        
        /**
         * 停止 AssetServer
         */
        fun stopAssetServer() {
            synchronized(this) {
                assetServer?.let {
                    try {
                        it.stop()
                        Logger.i(TAG, "AssetServer stopped")
                    } catch (e: Exception) {
                        Logger.w(TAG, "Error stopping AssetServer", e)
                    }
                }
                assetServer = null
            }
        }

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
        
        // 延迟 5 秒恢复调度，等待 AssetServer、GeckoRuntime 等服务初始化完成
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            restoreAllSchedules()
        }, 5000)
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
            
            // Register unified scheduler once (not per-schedule)
            if (schedules.isNotEmpty()) {
                taskManager.schedulePeriodic(immediateFirstRun = true)
            }
            
            Logger.i(TAG, "All schedules restored")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to restore schedules", e)
        }
    }
    
    /**
     * 注意：App 启动时不执行 checkAllAndExecute
     * 
     * 定时任务完全由 WorkManager 调度，App 启动只负责恢复 WorkManager 任务
     * 如果跨天未执行过，WorkManager 的周期触发会在下次回调时通过 shouldExecute 判断
     * onResume 中的 checkAllAndExecute 也已移除，避免 App 打开就触发任务
     */
}
