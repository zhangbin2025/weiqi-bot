package com.weiqi.app.task

import android.content.Context
import com.weiqi.app.util.Logger
import org.json.JSONObject
import java.io.File

/**
 * ScheduleManager - 定时计划管理器（单例）
 *
 * 职责：
 * - JSON 文件存储
 * - 增删改查接口
 * - 线程安全：所有读写操作通过 synchronized(schedules) 保护
 */
class ScheduleManager private constructor(context: Context) {
    
    companion object {
        private const val TAG = "ScheduleManager"
        private const val FILE_NAME = "schedules.json"
        
        @Volatile
        private var instance: ScheduleManager? = null
        
        fun getInstance(context: Context): ScheduleManager {
            return instance ?: synchronized(this) {
                instance ?: ScheduleManager(context.applicationContext).also { instance = it }
            }
        }
    }
    
    private val file = File(context.filesDir, FILE_NAME)
    private val schedules = JSONObject()
    
    init {
        load()
    }
    
    /**
     * 加载计划文件（构造时调用，无需锁）
     */
    private fun load() {
        try {
            if (file.exists()) {
                val content = file.readText()
                val loaded = JSONObject(content)
                val keys = loaded.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    schedules.put(key, loaded.get(key))
                }
                Logger.i(TAG, "Loaded ${schedules.length()} schedules")
            } else {
                save()
            }
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to load schedules", e)
        }
    }
    
    /**
     * 保存计划文件（调用方需持有 schedules 锁）
     */
    private fun save() {
        try {
            file.writeText(schedules.toString(2))
            Logger.d(TAG, "Saved schedules to file")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to save schedules", e)
        }
    }
    
    /**
     * 添加计划
     */
    fun add(config: JSONObject): String {
        val id = config.optString("id", "schedule_${System.currentTimeMillis()}")
        config.put("id", id)
        synchronized(schedules) {
            schedules.put(id, config)
            save()
        }
        Logger.i(TAG, "Added schedule: $id")
        return id
    }
    
    /**
     * 更新计划
     */
    fun update(id: String, config: JSONObject) {
        config.put("id", id)
        synchronized(schedules) {
            schedules.put(id, config)
            save()
        }
        Logger.i(TAG, "Updated schedule: $id")
    }
    
    /**
     * 删除计划
     */
    fun delete(id: String) {
        synchronized(schedules) {
            schedules.remove(id)
            save()
        }
        Logger.i(TAG, "Deleted schedule: $id")
    }
    
    /**
     * 获取计划
     */
    fun get(id: String): JSONObject? = synchronized(schedules) {
        schedules.optJSONObject(id)
    }
    
    /**
     * 列出所有计划
     */
    fun list(): List<JSONObject> = synchronized(schedules) {
        val list = mutableListOf<JSONObject>()
        val keys = schedules.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            schedules.optJSONObject(key)?.let { list.add(it) }
        }
        list
    }
}
