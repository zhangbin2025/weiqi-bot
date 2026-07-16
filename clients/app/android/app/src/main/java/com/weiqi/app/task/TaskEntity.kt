package com.weiqi.app.task

import android.content.Context
import com.weiqi.app.util.Logger
import org.json.JSONObject
import java.io.File

/**
 * TaskEntity - 后台任务实体（简化版，不使用 Room）
 */
data class TaskEntity(
    val id: String,
    val type: String,
    val params: String,
    val pageUrl: String,
    val status: String,
    val progress: Int,
    val progressMessage: String?,
    val createdAt: Long,
    val startedAt: Long?,
    val completedAt: Long?,
    val resultTitle: String?,
    val resultMessage: String?,
    val resultDetailUrl: String?,
    val error: String?,
    val scheduleType: String?,
    val scheduleInterval: Long?
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("id", id)
            put("type", type)
            put("params", params)
            put("pageUrl", pageUrl)
            put("status", status)
            put("progress", progress)
            put("progressMessage", progressMessage)
            put("createdAt", createdAt)
            put("startedAt", startedAt)
            put("completedAt", completedAt)
            put("resultTitle", resultTitle)
            put("resultMessage", resultMessage)
            put("resultDetailUrl", resultDetailUrl)
            put("error", error)
            put("scheduleType", scheduleType)
            put("scheduleInterval", scheduleInterval)
        }
    }
    
    companion object {
        fun fromJson(json: JSONObject): TaskEntity {
            return TaskEntity(
                id = json.getString("id"),
                type = json.getString("type"),
                params = json.getString("params"),
                pageUrl = json.getString("pageUrl"),
                status = json.getString("status"),
                progress = json.getInt("progress"),
                progressMessage = json.optString("progressMessage"),
                createdAt = json.getLong("createdAt"),
                startedAt = json.optLong("startedAt"),
                completedAt = json.optLong("completedAt"),
                resultTitle = json.optString("resultTitle"),
                resultMessage = json.optString("resultMessage"),
                resultDetailUrl = json.optString("resultDetailUrl"),
                error = json.optString("error"),
                scheduleType = json.optString("scheduleType"),
                scheduleInterval = json.optLong("scheduleInterval")
            )
        }
    }
}
