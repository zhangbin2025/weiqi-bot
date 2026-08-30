package com.weiqi.app.task

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.weiqi.app.util.Logger
import org.json.JSONObject

/**
 * TaskWorker - WorkManager Worker
 *
 * 用于周期任务的触发
 * 只负责触发任务，实际执行由 TaskForegroundService 完成
 */
class TaskWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    
    companion object {
        private const val TAG = "TaskWorker"
        const val KEY_TASK_ID = "taskId"
        const val KEY_PAGE_URL = "pageUrl"
        const val KEY_PARAMS = "params"
    }
    
    override suspend fun doWork(): Result {
        val taskId = inputData.getString(KEY_TASK_ID)
        val pageUrl = inputData.getString(KEY_PAGE_URL)
        val paramsStr = inputData.getString(KEY_PARAMS)
        
        Logger.i(TAG, "Worker triggered for task: $taskId")
        
        // 检查 taskId 和 schedule 是否存在
        if (taskId == null) {
            Logger.w(TAG, "taskId is null, skipping execution")
            return Result.success()
        }
        
        val scheduleManager = ScheduleManager.getInstance(applicationContext)
        val config = scheduleManager.get(taskId)
        
        if (config == null) {
            Logger.w(TAG, "Schedule not found: $taskId, skipping execution")
            return Result.success()  // 不执行，直接返回成功
        }
        
        // ✅ 使用 TaskManager 的判断逻辑（避免代码重复）
        val taskManager = TaskManager(applicationContext)
        if (!taskManager.shouldExecute(config)) {
            Logger.i(TAG, "Schedule $taskId: not due yet, skipping")
            return Result.success()
        }
        
        // 启动前台服务执行任务
        if (pageUrl != null) {
            try {
                val params = if (paramsStr != null) JSONObject(paramsStr) else JSONObject()
                
                val intent = Intent(applicationContext, TaskForegroundService::class.java).apply {
                    action = TaskForegroundService.ACTION_EXECUTE_TASK
                    putExtra(TaskForegroundService.EXTRA_TASK_ID, taskId)
                    putExtra(TaskForegroundService.EXTRA_PAGE_URL, pageUrl)
                    putExtra(TaskForegroundService.EXTRA_PARAMS, params.toString())
                }
                
                // Android 8.0+ 需要使用 startForegroundService
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    applicationContext.startForegroundService(intent)
                } else {
                    applicationContext.startService(intent)
                }
                
                Logger.i(TAG, "Started foreground service for task: $taskId")
                return Result.success()
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to start foreground service for task: $taskId", e)
                return Result.failure()
            }
        }
        
        Logger.w(TAG, "Invalid task data: taskId=$taskId, pageUrl=$pageUrl")
        return Result.failure()
    }
}
