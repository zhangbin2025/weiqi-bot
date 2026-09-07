package com.weiqi.app.task

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.weiqi.app.util.Logger
import org.json.JSONObject

/**
 * TaskWorker - unified scheduler Worker
 *
 * Single WorkManager periodic task that:
 * 1. Iterates all schedules
 * 2. Executes due ones serially (one at a time)
 */
class TaskWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "TaskWorker"
    }

    override suspend fun doWork(): Result {
        Logger.i(TAG, "Scheduler tick started")

        val scheduleManager = ScheduleManager.getInstance(applicationContext)
        val taskManager = TaskManager(applicationContext)
        val schedules = scheduleManager.list()

        if (schedules.isEmpty()) {
            Logger.i(TAG, "No schedules found")
            return Result.success()
        }

        // Find all due schedules
        val dueSchedules = schedules.filter { config ->
            val id = config.optString("id")
            if (id.isEmpty()) return@filter false
            taskManager.shouldExecute(config).also { due ->
                if (!due) Logger.d(TAG, "Schedule $id: not due, skipping")
            }
        }

        if (dueSchedules.isEmpty()) {
            Logger.i(TAG, "No schedules due, tick complete")
            return Result.success()
        }

        Logger.i(TAG, "${dueSchedules.size} schedules due, executing serially")

        // Execute each schedule serially
        for (config in dueSchedules) {
            val scheduleId = config.optString("id")
            val pageUrl = taskManager.buildPageUrl(scheduleId, config)
            val params = config.optJSONObject("params") ?: JSONObject()

            Logger.i(TAG, "Executing schedule: $scheduleId")

            val success = executeAndWait(scheduleId, pageUrl, params.toString())
            if (!success) {
                Logger.w(TAG, "Schedule $scheduleId did not complete successfully, continuing to next")
            }
        }

        Logger.i(TAG, "Scheduler tick complete")
        return Result.success()
    }

    /**
     * Start foreground service and wait for task completion
     */
    private suspend fun executeAndWait(
        scheduleId: String,
        pageUrl: String,
        paramsStr: String
    ): Boolean {
        val store = TaskStore.getInstance(applicationContext)

        // Create task record
        store.create(
            id = scheduleId,
            type = "periodic",
            params = JSONObject(paramsStr),
            pageUrl = pageUrl,
            scheduleType = "periodic",
            scheduleInterval = 15 * 60L
        )

        // Start foreground service
        val intent = Intent(applicationContext, TaskForegroundService::class.java).apply {
            action = TaskForegroundService.ACTION_EXECUTE_TASK
            putExtra(TaskForegroundService.EXTRA_TASK_ID, scheduleId)
            putExtra(TaskForegroundService.EXTRA_PAGE_URL, pageUrl)
            putExtra(TaskForegroundService.EXTRA_PARAMS, paramsStr)
        }

        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                applicationContext.startForegroundService(intent)
            } else {
                applicationContext.startService(intent)
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to start service for $scheduleId", e)
            store.markFailed(scheduleId, "Failed to start service: ${e.message}")
            return false
        }

        // Wait for completion (poll every 2s, max 10 min)
        val maxWaitMs = 10 * 60 * 1000L
        val pollIntervalMs = 2000L
        val startTime = System.currentTimeMillis()

        while (System.currentTimeMillis() - startTime < maxWaitMs) {
            kotlinx.coroutines.delay(pollIntervalMs)
            val task = store.get(scheduleId)
            if (task == null) {
                Logger.w(TAG, "Task $scheduleId disappeared from store")
                return false
            }
            when (task.status) {
                "completed" -> {
                    Logger.i(TAG, "Task $scheduleId completed")
                    return true
                }
                "failed" -> {
                    Logger.w(TAG, "Task $scheduleId failed: ${task.error}")
                    return false
                }
                "cancelled" -> {
                    Logger.i(TAG, "Task $scheduleId cancelled")
                    return false
                }
            }
        }

        Logger.w(TAG, "Task $scheduleId timed out after ${maxWaitMs / 1000}s")
        return false
    }
}
