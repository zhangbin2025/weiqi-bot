package com.weiqi.app.task

import android.content.Context
import android.content.Intent
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.weiqi.app.util.Logger
import kotlinx.coroutines.Dispatchers
import com.weiqi.app.AppConfig
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Calendar
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * TaskManager - 任务管理器
 *
 * 职责：
 * - 提供统一的任务管理接口
 * - 提交立即任务（启动前台服务）
 * - 提交周期任务（通过 WorkManager）
 * - 查询任务状态
 * - 取消任务
 */
class TaskManager(private val context: Context) {
    
    companion object {
        private const val TAG = "TaskManager"
        const val SCHEDULER_WORK_NAME = "weiqi_unified_scheduler"
    }
    
    private val store = TaskStore.getInstance(context)
    private val workManager = WorkManager.getInstance(context)
    
    /**
     * 提交任务
     *
     * @param type 任务类型
     * @param params 任务参数
     * @param pageUrl 页面 URL
     * @param schedule 调度配置（可选，用于周期任务）
     * @return 任务 ID
     */
    suspend fun submit(
        type: String,
        params: JSONObject,
        pageUrl: String?,
        schedule: JSONObject? = null
    ): String {
        // 判断是否是周期任务
        val isPeriodic = schedule != null && schedule.optString("type") == "periodic"
        
        // 优先使用 schedule ID（用于通知判断），否则生成新 task ID
        val taskId = schedule?.optString("id")?.takeIf { it.isNotEmpty() }
            ?: generateTaskId()
        
        Logger.i(TAG, "Submitting task: id=$taskId, type=$type, pageUrl=$pageUrl, isPeriodic=$isPeriodic")
        
        // 构造页面 URL（添加 taskId 参数）
        val finalPageUrl = addTaskIdToUrl(pageUrl, taskId)
        
        if (isPeriodic) {
            // 周期任务：保存并调度
            // 固定 15 分钟间隔
            schedulePeriodic(taskId, 15)
            
            // 保存任务
            store.create(
                id = taskId,
                type = type,
                params = params,
                pageUrl = finalPageUrl,
                scheduleType = "periodic",
                scheduleInterval = 15 * 60L  // 15 分钟
            )
        } else {
            // 立即任务：启动前台服务
            store.create(
                id = taskId,
                type = type,
                params = params,
                pageUrl = finalPageUrl,
                scheduleType = "immediate"
            )
            
            executeNow(taskId, finalPageUrl, params)
        }
        
        Logger.i(TAG, "Submitted task $taskId: type=$type")
        return taskId
    }
    
    /**
     * 立即执行任务（内部方法）
     */
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    internal fun executeNow(taskId: String, pageUrl: String, params: JSONObject) {
        val intent = Intent(context, TaskForegroundService::class.java).apply {
            action = TaskForegroundService.ACTION_EXECUTE_TASK
            putExtra(TaskForegroundService.EXTRA_TASK_ID, taskId)
            putExtra(TaskForegroundService.EXTRA_PAGE_URL, pageUrl)
            putExtra(TaskForegroundService.EXTRA_PARAMS, params.toString())
        }
        
        try {
            // Android 8.0+ 需要使用 startForegroundService
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            Logger.i(TAG, "Started foreground service for task $taskId")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to start foreground service for task $taskId", e)
            // 标记任务失败（使用 GlobalScope 因为 executeNow 不是 suspend 函数）
            kotlinx.coroutines.GlobalScope.launch {
                store.markFailed(taskId, "Failed to start service: ${e.message}")
            }
        }
    }
    
    /**
     * Register or update the unified scheduler Worker.
     * All schedules share one Worker that ticks every intervalMinutes.
     */
    fun schedulePeriodic(scheduleId: String = "", intervalMinutes: Int = 15, immediateFirstRun: Boolean = false) {
        val workBuilder = PeriodicWorkRequestBuilder<TaskWorker>(intervalMinutes.toLong(), TimeUnit.MINUTES)

        if (!immediateFirstRun) {
            workBuilder.setInitialDelay(intervalMinutes.toLong(), TimeUnit.MINUTES)
        }

        val work = workBuilder.build()

        workManager.enqueueUniquePeriodicWork(
            SCHEDULER_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            work
        )

        Logger.i(TAG, "Unified scheduler: interval=${intervalMinutes}min, immediateFirstRun=$immediateFirstRun")
    }

    /**
     * Build pageUrl for a schedule (used by TaskWorker)
     */
    fun buildPageUrl(scheduleId: String, config: JSONObject): String {
        var pageUrl = config.optString("pageUrl", AppConfig.localPageUrl("index.html"))

        val encodedId = java.net.URLEncoder.encode(scheduleId, "UTF-8")
        pageUrl = pageUrl.replace("__SCHEDULE_ID__".toRegex(), encodedId)

        if (!pageUrl.contains("://")) {
            pageUrl = AppConfig.localPageUrl(pageUrl)
        }

        if (pageUrl.contains("taskId=")) {
            pageUrl = pageUrl.replace("taskId=[^&]*".toRegex(), "")
            pageUrl = pageUrl.replace("[?&]$".toRegex(), "")
        }

        val separator = if (pageUrl.contains("?")) "&" else "?"
        return "$pageUrl${separator}taskId=${encodedId}"
    }
    
    /**
     * 获取任务状态
     */
    suspend fun getStatus(taskId: String): TaskEntity? {
        return store.get(taskId)
    }
    
    /**
     * 列出任务
     */
    suspend fun listTasks(statuses: List<String> = listOf("pending", "running")): List<TaskEntity> {
        return store.list(statuses)
    }
    
    /**
     * 获取已完成的任务
     */
    suspend fun getCompletedTasks(): List<TaskEntity> {
        return store.getCompletedTasks()
    }
    
    /**
     * 删除任务
     */
    suspend fun deleteTask(taskId: String) {
        // 如果是周期任务，取消 WorkManager 任务
        workManager.cancelUniqueWork(taskId)
        
        // 从存储中删除
        store.delete(taskId)
        
        Logger.i(TAG, "Deleted task: $taskId")
    }
    
    /**
     * 取消任务
     */
    suspend fun cancelTask(taskId: String): Boolean {
        try {
            // 取消 WorkManager 任务
            workManager.cancelUniqueWork(taskId)
            
            // 发送停止意图给前台服务
            val intent = Intent(context, TaskForegroundService::class.java).apply {
                action = TaskForegroundService.ACTION_STOP_TASK
                putExtra(TaskForegroundService.EXTRA_TASK_ID, taskId)
            }
            
            // STOP 意图使用 startService（不要求服务调用 startForeground）
            context.startService(intent)
            
            // 更新状态
            store.markCancelled(taskId)
            
            Logger.i(TAG, "Cancelled task: $taskId")
            return true
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to cancel task $taskId", e)
            return false
        }
    }
    
    /**
     * 清理过期任务
     */
    suspend fun cleanup() {
        store.cleanup()
    }
    
    /**
     * 标记任务完成
     */
    suspend fun markCompleted(id: String, title: String?, message: String?, detailUrl: String?) {
        val notifier = TaskNotifier(context)
        store.markCompleted(id, title, message, detailUrl)
        notifier.notify(id, title ?: "任务完成", message ?: "", detailUrl)
        Logger.i(TAG, "Task $id completed: $title")
    }
    
    /**
     * 标记任务失败
     */
    suspend fun markFailed(id: String, error: String) {
        val notifier = TaskNotifier(context)
        store.markFailed(id, error)
        notifier.notifyError(id, error)
        Logger.i(TAG, "Task $id failed: $error")
    }
    
    // ========== 调度相关接口 ==========
    
    /**
     * 添加调度
     */
    suspend fun addSchedule(config: JSONObject): String {
        val scheduleManager = ScheduleManager.getInstance(context)
        return scheduleManager.add(config)
    }
    
    /**
     * 更新调度
     */
    suspend fun updateSchedule(id: String, config: JSONObject) {
        val scheduleManager = ScheduleManager.getInstance(context)
        scheduleManager.update(id, config)
    }
    
    /**
     * 删除调度
     */
    suspend fun deleteSchedule(id: String) {
        // Note: unified Worker is not cancelled per-schedule;
        // it will skip this schedule on next tick since it's removed from ScheduleManager
        
        // 1. 删除 TaskStore 中的 task 记录
        store.delete(id)
        
        // 3. 停止正在运行的前台服务（如果有）
        val intent = Intent(context, TaskForegroundService::class.java).apply {
            action = TaskForegroundService.ACTION_STOP_TASK
            putExtra(TaskForegroundService.EXTRA_TASK_ID, id)
        }
        
        try {
            // STOP 意图使用 startService（不要求服务调用 startForeground）
            context.startService(intent)
        } catch (e: Exception) {
            Logger.w(TAG, "Failed to stop service for schedule $id", e)
        }
        
        // 4. 删除 schedule 配置
        val scheduleManager = ScheduleManager.getInstance(context)
        scheduleManager.delete(id)
        
        Logger.i(TAG, "Deleted schedule: $id")
    }
    
    /**
     * 获取调度
     */
    suspend fun getSchedule(id: String): JSONObject? {
        val scheduleManager = ScheduleManager.getInstance(context)
        return scheduleManager.get(id)
    }
    
    /**
     * 列出所有调度
     */
    suspend fun listSchedules(): List<JSONObject> {
        val scheduleManager = ScheduleManager.getInstance(context)
        return scheduleManager.list()
    }
    
    // ========== 立即检查和执行 ==========
    
    /**
     * 检查并立即执行调度（如果需要）
     * 
     * 用于 App 启动/恢复时检查是否有到期的任务
     */
    fun checkAndExecuteNow(scheduleId: String) {
        val scheduleManager = ScheduleManager.getInstance(context)
        val config = scheduleManager.get(scheduleId)
        
        if (config == null) {
            Logger.w(TAG, "Schedule not found: $scheduleId")
            return
        }
        
        // 检查是否需要执行
        if (!shouldExecute(config)) {
            Logger.d(TAG, "Schedule $scheduleId: not due yet, skipping")
            return
        }

        
        // 需要执行，立即启动
        Logger.i(TAG, "Schedule $scheduleId: due now, executing immediately")
        
        // 构造 pageUrl
        var pageUrl = config.optString("pageUrl", AppConfig.localPageUrl("index.html"))
        val encodedId = java.net.URLEncoder.encode(scheduleId, "UTF-8")
        pageUrl = pageUrl.replace("__SCHEDULE_ID__".toRegex(), encodedId)
        
        if (!pageUrl.contains("://")) {
            pageUrl = AppConfig.localPageUrl(pageUrl)
        }
        
        // 添加 taskId 参数
        val separator = if (pageUrl.contains("?")) "&" else "?"
        pageUrl = "$pageUrl${separator}taskId=${encodedId}"
        
        val params = config.optJSONObject("params") ?: JSONObject()
        
        // 立即执行
        // 注意：不在这里更新 lastRunDate，等任务真正完成/失败时由 TaskForegroundService 更新
        // 否则任务可能还没跑完就标记为已执行，导致当天不再重试
        executeNow(scheduleId, pageUrl, params)
    }
    
    /**
     * 检查所有调度并立即执行（如果需要）
     * 
     * 用于 App 启动/恢复时批量检查
     */
    fun checkAllAndExecute() {
        try {
            val scheduleManager = ScheduleManager.getInstance(context)
            val schedules = scheduleManager.list()
            
            Logger.i(TAG, "Checking ${schedules.size} schedules for immediate execution")
            
            for (config in schedules) {
                val id = config.optString("id")
                if (id.isNotEmpty()) {
                    checkAndExecuteNow(id)
                }
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to check all schedules", e)
        }
    }
    
    /**
     * 判断是否需要执行
     * 
     * 规则：
     * - 只要当前周期（天/周/月）内没有执行过，就执行一次
     */
    fun shouldExecute(config: JSONObject): Boolean {
        val now = Calendar.getInstance()
        val frequency = config.optString("frequency", "daily")
        val lastRunDate = config.optString("lastRunDate", "")
        
        // 从未执行过 → 执行
        if (lastRunDate.isEmpty()) {
            Logger.d(TAG, "Never executed, will execute")
            return true
        }
        
        // 已执行过 → 检查是否跨周期
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
    fun formatDate(calendar: Calendar): String {
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
    
    // ========== 辅助方法 ==========
    
    /**
     * 生成任务 ID
     */
    private fun generateTaskId(): String {
        return "task_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
    }
    
    /**
     * 在 URL 上添加 taskId 参数
     */
    private fun addTaskIdToUrl(url: String?, taskId: String): String {
        if (url.isNullOrBlank()) {
            return AppConfig.localPageUrl("index.html?taskId=${java.net.URLEncoder.encode(taskId, "UTF-8")}")
        }
        
        if (url.contains("taskId=")) {
            return url
        }
        
        val separator = if (url.contains("?")) "&" else "?"
        return "$url${separator}taskId=${java.net.URLEncoder.encode(taskId, "UTF-8")}"
    }
}
