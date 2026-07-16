package com.weiqi.app.task

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.weiqi.app.util.Logger
import org.json.JSONObject
import java.util.Calendar

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
        
        // ✅ 关键：判断是否需要执行
        if (!shouldExecute(config)) {
            Logger.i(TAG, "Schedule $taskId: shouldExecute=false, skipping")
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
    
    /**
     * 判断是否需要执行
     * 
     * 规则：
     * 1. 当前小时必须等于目标 hour（如目标 5 点，则 5:00-6:00 都算匹配）
     * 2. 从未执行过 → 执行
     * 3. 已执行过 → 检查是否跨周期（天/周/月）
     */
    private fun shouldExecute(config: JSONObject): Boolean {
        val now = Calendar.getInstance()
        val hour = config.optInt("hour", 0)
        val frequency = config.optString("frequency", "daily")
        val lastRunDate = config.optString("lastRunDate", "")
        
        // 1. 时间窗口检查：当前 hour 必须等于目标 hour
        val currentHour = now.get(Calendar.HOUR_OF_DAY)
        if (currentHour != hour) {
            Logger.d(TAG, "Hour mismatch: current=$currentHour, target=$hour")
            return false
        }
        
        // 2. 从未执行过 → 执行
        if (lastRunDate.isEmpty()) {
            Logger.d(TAG, "Never executed, will execute")
            return true
        }
        
        // 3. 已执行过 → 检查是否跨周期
        val today = formatDate(now)
        
        return when (frequency) {
            "daily" -> {
                val crossed = lastRunDate != today
                Logger.d(TAG, "Daily: lastRunDate=$lastRunDate, today=$today, crossed=$crossed")
                crossed
            }
            "weekly" -> {
                val crossed = !sameWeek(lastRunDate, today)
                Logger.d(TAG, "Weekly: lastRunDate=$lastRunDate, today=$today, crossed=$crossed")
                crossed
            }
            "monthly" -> {
                val crossed = !sameMonth(lastRunDate, today)
                Logger.d(TAG, "Monthly: lastRunDate=$lastRunDate, today=$today, crossed=$crossed")
                crossed
            }
            else -> {
                Logger.w(TAG, "Unknown frequency: $frequency")
                false
            }
        }
    }
    
    /**
     * 格式化日期为 YYYY-MM-DD
     */
    private fun formatDate(calendar: Calendar): String {
        return String.format("%04d-%02d-%02d",
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH) + 1,
            calendar.get(Calendar.DAY_OF_MONTH))
    }
    
    /**
     * 判断两个日期是否在同一周
     */
    private fun sameWeek(date1: String, date2: String): Boolean {
        try {
            val parts1 = date1.split("-").map { it.toInt() }
            val parts2 = date2.split("-").map { it.toInt() }
            
            val cal1 = Calendar.getInstance().apply {
                set(Calendar.YEAR, parts1[0])
                set(Calendar.MONTH, parts1[1] - 1)
                set(Calendar.DAY_OF_MONTH, parts1[2])
            }
            
            val cal2 = Calendar.getInstance().apply {
                set(Calendar.YEAR, parts2[0])
                set(Calendar.MONTH, parts2[1] - 1)
                set(Calendar.DAY_OF_MONTH, parts2[2])
            }
            
            val week1 = cal1.get(Calendar.WEEK_OF_YEAR)
            val year1 = cal1.get(Calendar.YEAR)
            val week2 = cal2.get(Calendar.WEEK_OF_YEAR)
            val year2 = cal2.get(Calendar.YEAR)
            
            return week1 == week2 && year1 == year2
        } catch (e: Exception) {
            return false
        }
    }
    
    /**
     * 判断两个日期是否在同一月
     */
    private fun sameMonth(date1: String, date2: String): Boolean {
        try {
            val parts1 = date1.split("-")
            val parts2 = date2.split("-")
            
            return parts1[0] == parts2[0] && parts1[1] == parts2[1]
        } catch (e: Exception) {
            return false
        }
    }
}
