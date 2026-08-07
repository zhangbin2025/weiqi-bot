package com.weiqi.app.task

import android.content.Context
import com.weiqi.app.util.Logger
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

/**
 * TaskStore - 任务存储管理（JSON 文件实现）
 *
 * 职责：
 * - 任务 CRUD 操作
 * - 自动清理过期任务（1 天）
 * - 线程安全：所有读写操作通过 synchronized(tasks) 保护
 */
class TaskStore private constructor(context: Context) {
    
    companion object {
        private const val TAG = "TaskStore"
        private const val FILE_NAME = "tasks.json"
        private const val MAX_AGE_MS = 24 * 60 * 60 * 1000L  // 1 天
        
        @Volatile
        private var instance: TaskStore? = null
        
        fun getInstance(context: Context): TaskStore {
            return instance ?: synchronized(this) {
                instance ?: TaskStore(context.applicationContext).also { instance = it }
            }
        }
    }
    
    private val file = File(context.filesDir, FILE_NAME)
    private val tasks = mutableMapOf<String, TaskEntity>()
    
    init {
        loadFromFile()
    }
    
    /**
     * 从文件加载任务
     */
    private fun loadFromFile() {
        try {
            if (!file.exists()) {
                return
            }
            
            val content = file.readText()
            val jsonArray = JSONArray(content)
            
            for (i in 0 until jsonArray.length()) {
                val json = jsonArray.getJSONObject(i)
                val task = TaskEntity.fromJson(json)
                tasks[task.id] = task
            }
            
            Logger.i(TAG, "Loaded ${tasks.size} tasks from file")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to load tasks from file", e)
        }
    }
    
    /**
     * 保存任务到文件（调用方需持有 tasks 锁）
     */
    private fun saveToFile() {
        try {
            val jsonArray = JSONArray()
            tasks.values.forEach { task ->
                jsonArray.put(task.toJson())
            }
            
            file.writeText(jsonArray.toString())
            Logger.d(TAG, "Saved ${tasks.size} tasks to file")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to save tasks to file", e)
        }
    }
    
    /**
     * 创建任务
     */
    suspend fun create(
        id: String,
        type: String,
        params: JSONObject,
        pageUrl: String,
        scheduleType: String? = "immediate",
        scheduleInterval: Long? = null
    ): TaskEntity {
        val task = TaskEntity(
            id = id,
            type = type,
            params = params.toString(),
            pageUrl = pageUrl,
            status = "pending",
            progress = 0,
            progressMessage = null,
            createdAt = System.currentTimeMillis(),
            startedAt = null,
            completedAt = null,
            resultTitle = null,
            resultMessage = null,
            resultDetailUrl = null,
            error = null,
            scheduleType = scheduleType,
            scheduleInterval = scheduleInterval
        )
        
        synchronized(tasks) {
            tasks[id] = task
            saveToFile()
        }
        Logger.i(TAG, "Created task: $id, type=$type")
        return task
    }
    
    /**
     * 获取任务
     */
    suspend fun get(id: String): TaskEntity? = synchronized(tasks) {
        tasks[id]
    }
    
    /**
     * 列出任务
     */
    suspend fun list(statuses: List<String> = listOf("pending", "running")): List<TaskEntity> = synchronized(tasks) {
        tasks.values.filter { it.status in statuses }
    }
    
    /**
     * 列出所有任务
     */
    suspend fun listAll(): List<TaskEntity> = synchronized(tasks) {
        tasks.values.toList()
    }
    
    /**
     * 列出已完成的任务
     */
    suspend fun getCompletedTasks(): List<TaskEntity> = synchronized(tasks) {
        tasks.values
            .filter { it.status == "completed" }
            .sortedByDescending { it.completedAt ?: 0 }
    }
    
    /**
     * 更新任务状态为 running
     */
    suspend fun markRunning(id: String) {
        synchronized(tasks) {
            tasks[id]?.let {
                tasks[id] = it.copy(
                    status = "running",
                    startedAt = System.currentTimeMillis()
                )
                saveToFile()
            }
        }
        Logger.i(TAG, "Task $id marked as running")
    }
    
    /**
     * 更新任务进度
     */
    suspend fun updateProgress(id: String, progress: Int, message: String?) {
        synchronized(tasks) {
            tasks[id]?.let {
                tasks[id] = it.copy(
                    progress = progress,
                    progressMessage = message
                )
                saveToFile()
            }
        }
        Logger.i(TAG, "Task $id progress: $progress% - $message")
    }
    
    /**
     * 标记任务完成
     */
    suspend fun markCompleted(id: String, title: String?, message: String?, detailUrl: String?) {
        synchronized(tasks) {
            tasks[id]?.let {
                tasks[id] = it.copy(
                    status = "completed",
                    completedAt = System.currentTimeMillis(),
                    resultTitle = title,
                    resultMessage = message,
                    resultDetailUrl = detailUrl
                )
                saveToFile()
            }
        }
        Logger.i(TAG, "Task $id completed: $title")
    }
    
    /**
     * 标记任务失败
     */
    suspend fun markFailed(id: String, error: String) {
        synchronized(tasks) {
            tasks[id]?.let {
                tasks[id] = it.copy(
                    status = "failed",
                    completedAt = System.currentTimeMillis(),
                    error = error
                )
                saveToFile()
            }
        }
        Logger.e(TAG, "Task $id failed: $error")
    }
    
    /**
     * 标记任务取消
     */
    suspend fun markCancelled(id: String) {
        synchronized(tasks) {
            tasks[id]?.let {
                tasks[id] = it.copy(
                    status = "cancelled",
                    completedAt = System.currentTimeMillis()
                )
                saveToFile()
            }
        }
        Logger.i(TAG, "Task $id cancelled")
    }
    
    /**
     * 删除任务
     */
    suspend fun delete(id: String) {
        synchronized(tasks) {
            tasks.remove(id)
            saveToFile()
        }
        Logger.i(TAG, "Deleted task: $id")
    }
    
    /**
     * 清理过期任务（超过 1 天）
     */
    suspend fun cleanup() {
        val threshold = System.currentTimeMillis() - MAX_AGE_MS
        synchronized(tasks) {
            val toDelete = tasks.values.filter { it.createdAt < threshold }.map { it.id }
            toDelete.forEach { tasks.remove(it) }
            
            if (toDelete.isNotEmpty()) {
                saveToFile()
                Logger.i(TAG, "Cleaned up ${toDelete.size} expired tasks")
            }
        }
    }
    
    /**
     * 根据状态查询任务
     */
    fun getByStatus(status: String): List<TaskEntity> = synchronized(tasks) {
        tasks.values.filter { it.status == status }
    }
    
    /**
     * 获取所有任务
     */
    fun getAll(): List<TaskEntity> = synchronized(tasks) {
        tasks.values.toList()
    }
}
