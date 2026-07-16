package com.weiqi.app.katago

import android.content.Context
import com.weiqi.app.util.Logger
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * KataGoProcess — KataGo 原生进程管理
 *
 * 极简设计：只做三件事
 * 1. 管理进程生命周期（启动/关闭）
 * 2. 将 JSON 写入 stdin
 * 3. 从 stdout 逐行读取 JSON，通过回调推送给调用者
 *
 * 不做任何业务逻辑，所有逻辑由 TS 层负责。
 */
class KataGoProcess(private val context: Context) {

    enum class OpenCLMode {
        SYSTEM,
        BUNDLED
    }

    companion object {
        private const val TAG = "KataGoProcess"

        /** 二进制在 assets 中的路径 */
    }

    // ========== 进程状态 ==========

    @Volatile
    var isRunning: Boolean = false
        private set

    private var process: Process? = null
    private var writer: OutputStreamWriter? = null
    private var readerThread: Thread? = null
    private var heartbeatThread: Thread? = null

    /** 上次收到 stderr 的时间戳，用于心跳判断 */
    @Volatile
    private var lastStderrTime: Long = 0L

    /** 自增 ID，用于匹配请求和响应 */
    private val nextId = AtomicLong(0)

    /** 等待响应的回调：id -> callback(jsonString) */
    private val pendingCallbacks = ConcurrentHashMap<String, (String) -> Unit>()

    /** 全局消息回调（非 id 匹配的消息，如 error/warning） */
    var onMessage: ((JSONObject) -> Unit)? = null

    /** 进程意外退出回调 */
    var onExit: ((exitCode: Int) -> Unit)? = null

    /** 进程就绪回调（stdout 输出第一行非 error 信息时触发） */
    var onReady: (() -> Unit)? = null

    // ========== 公开 API ==========

    /**
     * 获取 KataGo 二进制文件路径
     *
     * 二进制打包在 jniLibs/arm64-v8a/libkatago.so，
     * Android 安装 APK 时自动解压到 nativeLibraryDir。
     * 无需手动安装，直接读取路径即可。
     *
     * @return 二进制文件路径
     */
    fun installBinary(): String {
        val libFile = File(context.applicationInfo.nativeLibraryDir, "libkatago.so")
        if (!libFile.exists()) {
            throw IllegalStateException("KataGo binary not found in nativeLibraryDir: ${libFile.absolutePath}")
        }
        Logger.d(TAG, "Binary path: ${libFile.absolutePath}")
        return libFile.absolutePath
    }

    /**
     * 启动 KataGo 进程
     *
     * @param configPath analysis.cfg 的绝对路径
     * @param modelPath 模型文件的绝对路径
     * @return true 启动成功
     */
    fun start(configPath: String, modelPath: String, openclMode: OpenCLMode = OpenCLMode.SYSTEM): Boolean {
        if (isRunning) {
            Logger.w(TAG, "Process already running")
            return true
        }

        val binPath = installBinary()

        // 验证配置和模型文件存在
        if (!File(configPath).exists()) {
            Logger.e(TAG, "Config file not found: $configPath")
            return false
        }
        if (!File(modelPath).exists()) {
            Logger.e(TAG, "Model file not found: $modelPath")
            return false
        }

        Logger.i(TAG, "Starting KataGo: bin=$binPath config=$configPath model=$modelPath")

        return try {
            val builder = ProcessBuilder(binPath, "analysis", "-config", configPath, "-model", modelPath)
                .redirectErrorStream(false)  // stderr 单独读取

            // 设置 HOME 环境变量（某些 OpenCL 实现需要）
            builder.environment()["HOME"] = context.filesDir.absolutePath
            // 设置 LD_LIBRARY_PATH
            // SYSTEM：使用系统 vendor 路径，让子进程 linker 能找到系统自带的 libOpenCL.so
            //   添加多个可能的库路径，包括 egl/hw 等子目录（部分 GPU 驱动依赖这些目录下的库）
            // BUNDLED：只用 app 的 nativeLibraryDir（clvk）
            val abi = if (android.os.Build.SUPPORTED_64_BIT_ABIS.isNotEmpty()) "lib64" else "lib"
            val libPaths = when (openclMode) {
                OpenCLMode.SYSTEM -> listOf(
                    "/system/vendor/$abi",
                    "/vendor/$abi",
                    "/system/vendor/$abi/egl",
                    "/system/vendor/$abi/hw",
                    "/system/$abi",
                    "/vendor/$abi/egl",
                    "/vendor/$abi/hw",
                    context.applicationInfo.nativeLibraryDir
                )
                OpenCLMode.BUNDLED -> listOf(context.applicationInfo.nativeLibraryDir)
            }
            val existingLdPath = builder.environment()["LD_LIBRARY_PATH"] ?: ""
            val newPath = libPaths.joinToString(":")
            builder.environment()["LD_LIBRARY_PATH"] =
                if (existingLdPath.isNotEmpty()) "$newPath:$existingLdPath" else newPath
            Logger.i(TAG, "LD_LIBRARY_PATH set to: ${builder.environment()["LD_LIBRARY_PATH"]}")
            process = builder.start()
            isRunning = true

            // 获取 stdin writer
            writer = OutputStreamWriter(process!!.outputStream, Charsets.UTF_8)

            // 启动 stdout 读取线程
            startStdoutReader()

            // 启动 stderr 读取线程（日志输出）
            startStderrReader()

            // 启动心跳线程：进程活着但长时间无输出时，主动推送 keep-alive
            startHeartbeatThread()

            Logger.i(TAG, "KataGo process started: $binPath")
            true
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to start KataGo process", e)
            Logger.e(TAG, "Exception class: ${e.javaClass.name}, message: ${e.message}")
            isRunning = false
            false
        }
    }

    /**
     * 发送查询到 KataGo stdin
     *
     * @param query KataGo analysis 协议的 JSON 查询（单行）
     * @return 分配的 query id，用于匹配响应
     */
    fun sendQuery(query: String, callback: (String) -> Unit): String {
        val id = "q${nextId.getAndIncrement()}"
        pendingCallbacks[id] = callback

        // 注入/替换 id 字段到查询 JSON
        val json = try {
            val obj = JSONObject(query)
            obj.put("id", id)
            obj.toString()
        } catch (e: Exception) {
            // 如果不是有效 JSON，包装一下
            """{"id":"$id","raw":$query}"""
        }

        return try {
            writer?.apply {
                write(json)
                write("\n")
                flush()
            }
            Logger.d(TAG, "Sent query id=$id")
            id
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to send query", e)
            pendingCallbacks.remove(id)
            throw e
        }
    }

    /**
     * 发送原始行到 stdin（不带 id 注入）
     *
     * 用于 TS 层完全控制请求格式的场景。
     */
    fun sendRawLine(line: String) {
        try {
            writer?.apply {
                write(line)
                write("\n")
                flush()
            }
            Logger.d(TAG, "Sent raw line: ${line.take(100)}")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to send raw line", e)
            throw e
        }
    }

    /**
     * 注册回调等待指定 id 的响应
     *
     * 当 TS 层自己管理 id 时使用。
     */
    fun registerCallback(id: String, callback: (String) -> Unit) {
        pendingCallbacks[id] = callback
    }

    /**
     * 移除回调
     */
    fun removeCallback(id: String) {
        pendingCallbacks.remove(id)
    }

    /**
     * 关闭 KataGo 进程
     */
    fun shutdown() {
        if (!isRunning) return

        Logger.i(TAG, "Shutting down KataGo process")

        try {
            // 关闭 stdin，KataGo 会完成队列中的分析后退出
            writer?.close()
        } catch (e: Exception) {
            Logger.w(TAG, "Error closing stdin", e)
        }

        // 等待进程退出（最多 5 秒）
        try {
            process?.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
        } catch (e: Exception) {
            Logger.w(TAG, "Timeout waiting for process exit", e)
        }

        // 强制销毁
        try {
            process?.destroyForcibly()
        } catch (e: Exception) {
            Logger.w(TAG, "Error destroying process", e)
        }

        process = null
        writer = null
        readerThread = null
        heartbeatThread = null
        isRunning = false
        pendingCallbacks.clear()

        Logger.i(TAG, "KataGo process shut down")
    }

    // ========== 私有方法 ==========

    private fun startStdoutReader() {
        val proc = process ?: return
        readerThread = Thread({
            try {
                val reader = BufferedReader(InputStreamReader(proc.inputStream, Charsets.UTF_8))
                var line: String?
                var firstValidLine = true

                while (reader.readLine().also { line = it } != null) {
                    val text = line ?: continue
                    Logger.d(TAG, "stdout: ${text.take(200)}")

                    try {
                        val json = JSONObject(text)

                        // 检查是否有 id 字段（分析结果）
                        val id: String? = json.optString("id", "")
                        if (id != null && id.isNotEmpty()) {
                            val callback = pendingCallbacks.remove(id)
                            if (callback != null) {
                                callback(text)
                            } else {
                                // 没有匹配的回调，走全局消息
                                onMessage?.invoke(json)
                            }
                        } else {
                            // 无 id 的消息（error / warning / 等）
                            onMessage?.invoke(json)
                        }

                        // 首次收到有效响应，标记就绪
                        if (firstValidLine && !json.has("error")) {
                            firstValidLine = false
                            onReady?.invoke()
                        }
                    } catch (e: Exception) {
                        // 非 JSON 行，忽略
                        Logger.w(TAG, "Non-JSON stdout: ${text.take(100)}")
                    }
                }
            } catch (e: Exception) {
                if (isRunning) {
                    Logger.e(TAG, "stdout reader error", e)
                }
            } finally {
                var exitCode = -1
                try {
                    exitCode = proc.waitFor()
                } catch (e: Exception) {
                    // already -1
                }

                isRunning = false
                Logger.i(TAG, "KataGo process exited with code $exitCode")
                onExit?.invoke(exitCode)
            }
        }, "katago-stdout")
        readerThread!!.isDaemon = true
        readerThread!!.start()
    }


    /**
     * 心跳线程：当进程活着但长时间没有 stderr 输出时，
     * 主动推送 katago:heartbeat 给 TS 层，防止超时。
     *
     * 场景：KataGo tuning 某些步骤很慢，可能 30-60 秒无输出。
     */
    private fun startHeartbeatThread() {
        val proc = process ?: return
        lastStderrTime = System.currentTimeMillis()
        heartbeatThread = Thread({
            try {
                while (proc.isAlive) {
                    Thread.sleep(15000) // 每 15 秒检查一次
                    if (!proc.isAlive) break
                    val elapsed = System.currentTimeMillis() - lastStderrTime
                    if (elapsed > 30000) { // 30 秒无 stderr 输出
                        try {
                            val heartbeatJson = JSONObject().apply {
                                put("type", "katago:heartbeat")
                                put("elapsed", elapsed)
                            }
                            onMessage?.invoke(heartbeatJson)
                            Logger.d(TAG, "Heartbeat: no stderr for ${elapsed}ms")
                        } catch (e: Exception) {
                            Logger.w(TAG, "Failed to send heartbeat", e)
                        }
                    }
                }
            } catch (e: InterruptedException) {
                // 正常退出
            } catch (e: Exception) {
                if (isRunning) {
                    Logger.e(TAG, "Heartbeat thread error", e)
                }
            }
        }, "katago-heartbeat")
        heartbeatThread!!.isDaemon = true
        heartbeatThread!!.start()
    }

    private fun startStderrReader() {
        val proc = process ?: return
        Thread({
            try {
                val reader = BufferedReader(InputStreamReader(proc.errorStream, Charsets.UTF_8))
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    val text = line ?: continue
                    // KataGo stderr 包含启动日志和运行时信息
                    lastStderrTime = System.currentTimeMillis()
                    Logger.d(TAG, "stderr: ${text.take(200)}")
                    
                    // 检测 Tuning 进度，发送进度通知让前端重置超时计时器
                    if (text.contains("Tuning ") && text.contains("/")) {
                        try {
                            val progressJson = JSONObject().apply {
                                put("type", "katago_progress")
                                put("stage", "tuning")
                                put("message", text)
                            }
                            onMessage?.invoke(progressJson)
                        } catch (e: Exception) {
                            Logger.w(TAG, "Failed to send tuning progress", e)
                        }
                    }

                    // 检测 "Started, ready to begin handling requests" 表示进程就绪
                    if (text.contains("Started, ready to begin handling requests")) {
                        Logger.i(TAG, "KataGo is ready")
                        onReady?.invoke()
                    }
                }
            } catch (e: Exception) {
                if (isRunning) {
                    Logger.e(TAG, "stderr reader error", e)
                }
            }
        }, "katago-stderr").apply {
            isDaemon = true
            start()
        }
    }
}
