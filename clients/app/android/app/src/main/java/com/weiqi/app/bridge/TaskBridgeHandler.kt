package com.weiqi.app.bridge

import android.app.Activity
import com.weiqi.app.util.Logger
import com.weiqi.app.AppConfig
import androidx.lifecycle.LifecycleCoroutineScope
import com.weiqi.app.task.ScheduleManager
import com.weiqi.app.task.TaskManager
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * TaskBridgeHandler - 任务桥接处理器
 *
 * 处理 task:* 前缀的桥接消息，消息格式：
 * - 一级 action：task:{action}:{json}        如 task:submit:{...}
 * - 二级 action：task:schedule:{action}:{json} 如 task:schedule:add:{...}
 */
class TaskBridgeHandler(
    private val activity: Activity,
    private val lifecycleScope: LifecycleCoroutineScope,
    private val taskManager: TaskManager?
) : BridgeHandler {

    companion object {
        private const val TAG = "TaskBridgeHandler"
    }

    override val prefix: String = "task:"

    override fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
        val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()

        if (taskManager == null) {
            Logger.w(TAG, "TaskManager not initialized")
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"TaskManager not initialized\"}"))
        }

        try {
            // 解析消息：task:{action}:{json} 或 task:schedule:{subAction}:{json}
            // 第一步：split(limit=3) 保留 JSON 中的冒号
            //   task:submit:{"type":"sniffer",...}  → [task, submit, {"type":"sniffer",...}]
            //   task:schedule:add:{"id":"...",...}  → [task, schedule, add:{"id":"...",...}]
            val parts = message.split(":", limit = 3)
            if (parts.size < 3) {
                return GeckoResult.fromValue(prompt.confirm("{\"error\":\"Invalid format\"}"))
            }

            val action = parts[1]
            val rest = parts[2]

            // 第二步：如果是 schedule，再拆一层 subAction:json
            val resolvedAction: String
            val jsonStr: String
            if (action == "schedule") {
                val colonIdx = rest.indexOf(':')
                if (colonIdx > 0) {
                    resolvedAction = "schedule:${rest.substring(0, colonIdx)}"
                    jsonStr = rest.substring(colonIdx + 1)
                } else {
                    // task:schedule:list 之类无 JSON 的调用
                    resolvedAction = "schedule:$rest"
                    jsonStr = ""
                }
            } else {
                resolvedAction = action
                jsonStr = rest
            }

            lifecycleScope.launch {
                try {
                    val response = handleAction(resolvedAction, jsonStr)
                    result.complete(prompt.confirm(response))
                } catch (e: Exception) {
                    Logger.e(TAG, "Failed to handle task prompt", e)
                    result.complete(prompt.confirm("{\"error\":\"${e.message}\"}"))
                }
            }

            return result
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to parse task prompt", e)
            return GeckoResult.fromValue(prompt.confirm("{\"error\":\"${e.message}\"}"))
        }
    }

    /**
     * 分发 action 到对应处理逻辑
     */
    private suspend fun handleAction(action: String, jsonStr: String): String {
        val scheduleManager = ScheduleManager.getInstance(activity)

        return when (action) {
            // ========== 任务操作 ==========
            "submit" -> {
                val json = JSONObject(jsonStr)
                val type = json.getString("type")
                val params = json.getJSONObject("params")
                val pageUrl = json.optString("pageUrl", "")
                val schedule = json.optJSONObject("schedule")
                val taskId = taskManager!!.submit(type, params, pageUrl, schedule)
                JSONObject().put("taskId", taskId).toString()
            }
            "status" -> {
                val task = taskManager!!.getStatus(jsonStr)
                if (task != null) {
                    JSONObject().apply {
                        put("id", task.id)
                        put("type", task.type)
                        put("status", task.status)
                        put("progress", task.progress)
                        put("progressMessage", task.progressMessage)
                        put("result", JSONObject().apply {
                            put("title", task.resultTitle)
                            put("message", task.resultMessage)
                            put("detailUrl", task.resultDetailUrl)
                        })
                    }.toString()
                } else {
                    JSONObject().put("error", "Task not found").toString()
                }
            }
            "list" -> {
                val filter = if (jsonStr.isNotEmpty()) JSONObject(jsonStr) else JSONObject()
                val statuses = filter.optJSONArray("statuses")?.let { arr ->
                    (0 until arr.length()).map { arr.getString(it) }
                } ?: listOf("pending", "running")
                val tasks = taskManager!!.listTasks(statuses)
                JSONArray().apply {
                    tasks.forEach { task ->
                        put(JSONObject().apply {
                            put("id", task.id)
                            put("type", task.type)
                            put("status", task.status)
                            put("progress", task.progress)
                            put("progressMessage", task.progressMessage)
                            put("createdAt", task.createdAt)
                        })
                    }
                }.toString()
            }
            "listCompleted" -> {
                val tasks = taskManager!!.getCompletedTasks()
                JSONArray().apply {
                    tasks.forEach { task ->
                        put(JSONObject().apply {
                            put("id", task.id)
                            put("type", task.type)
                            put("status", task.status)
                            put("title", task.resultTitle ?: "")
                            put("message", task.resultMessage ?: "")
                            put("detailUrl", task.resultDetailUrl ?: "")
                            put("createdAt", task.createdAt)
                            put("completedAt", task.completedAt)
                        })
                    }
                }.toString()
            }
            "delete" -> {
                taskManager!!.deleteTask(jsonStr)
                JSONObject().put("success", true).toString()
            }
            "cancel" -> {
                val success = taskManager!!.cancelTask(jsonStr)
                JSONObject().put("success", success).toString()
            }
            "complete" -> {
                val json = JSONObject(jsonStr)
                taskManager!!.markCompleted(
                    json.getString("taskId"),
                    json.getString("title"),
                    json.getString("message"),
                    json.optString("detailUrl", "").takeIf { it.isNotEmpty() }
                )
                JSONObject().put("success", true).toString()
            }
            "fail" -> {
                val json = JSONObject(jsonStr)
                taskManager!!.markFailed(json.getString("taskId"), json.getString("error"))
                JSONObject().put("success", true).toString()
            }

            // ========== 调度操作 ==========
            "schedule:add" -> {
                val config = JSONObject(jsonStr)
                val id = scheduleManager.add(config)
                // 入队 WorkManager 15分钟周期任务
                taskManager!!.schedulePeriodic(id, 15)
                JSONObject().put("id", id).toString()
            }
            "schedule:update" -> {
                val json = JSONObject(jsonStr)
                scheduleManager.update(json.getString("id"), json.getJSONObject("config"))
                JSONObject().put("success", true).toString()
            }
            "schedule:delete" -> {
                scheduleManager.delete(jsonStr)
                JSONObject().put("success", true).toString()
            }
            "schedule:get" -> {
                scheduleManager.get(jsonStr)?.toString()
                    ?: JSONObject().put("error", "Schedule not found").toString()
            }
            "schedule:list" -> {
                JSONArray().apply {
                    scheduleManager.list().forEach { put(it) }
                }.toString()
            }
            "schedule:run" -> {
                val config = scheduleManager.get(jsonStr)
                if (config == null) {
                    JSONObject().put("error", "Schedule not found").toString()
                } else {
                    val pageUrlTemplate = config.optString("pageUrl")
                    val params = config.optJSONObject("params") ?: JSONObject()
                    val type = config.optString("type", "unknown")

                    var pageUrl = pageUrlTemplate.replace(
                        "__SCHEDULE_ID__",
                        java.net.URLEncoder.encode(jsonStr, "UTF-8")
                    )
                    if (!pageUrl.contains("://")) {
                        pageUrl = AppConfig.localPageUrl(pageUrl)
                    }

                    val scheduleConfig = JSONObject().apply {
                        put("id", jsonStr)
                        put("type", "periodic")
                    }
                    try {
                        taskManager!!.submit(type, params, pageUrl, scheduleConfig)
                        Logger.i(TAG, "Schedule executed immediately: $jsonStr")
                    } catch (e: Exception) {
                        Logger.e(TAG, "Failed to execute schedule: $jsonStr", e)
                    }
                    JSONObject().put("success", true).toString()
                }
            }

            else -> JSONObject().put("error", "Unknown action: $action").toString()
        }
    }
}
