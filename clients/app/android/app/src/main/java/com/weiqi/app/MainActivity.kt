package com.weiqi.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.ViewCompat
import androidx.lifecycle.lifecycleScope
import com.weiqi.app.debug.DebugBridge
import com.weiqi.app.geckoview.GeckoViewDelegateCallbacks
import com.weiqi.app.geckoview.GeckoViewDelegateHandler
import com.weiqi.app.sniffer.SnifferManager
import com.weiqi.app.task.TaskStore
import com.weiqi.app.task.TaskNotifier
import com.weiqi.app.task.TaskManager
import com.weiqi.app.ui.UIHelper
import java.io.File
import com.weiqi.app.util.Logger
import com.weiqi.app.bridge.TaskBridgeHandler
import com.weiqi.app.bridge.DebugBridgeHandler
import com.weiqi.app.bridge.ClipboardBridgeHandler
import com.weiqi.app.bridge.ConsoleBridgeHandler
import com.weiqi.app.bridge.SnifferBridgeHandler
import com.weiqi.app.bridge.FileBridgeHandler
import com.weiqi.app.bridge.ConfigBridgeHandler
import com.weiqi.app.katago.KataGoBridgeHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

/**
 * App 状态管理器（单例）
 * 用于判断 App 是否在前台、当前页面是否是 assistant
 */
object AppStateManager {
    @Volatile
    var isInForeground: Boolean = false
        private set
    
    @Volatile
    var currentUrl: String? = null
        private set
    
    fun setForeground(isForeground: Boolean) {
        isInForeground = isForeground
    }
    
    fun setCurrentUrl(url: String?) {
        currentUrl = url
    }
    
    /**
     * 判断是否需要发送通知
     * 返回 true 表示需要发送通知，false 表示不发送
     */
    fun shouldSendNotification(): Boolean {
        // 如果 App 不在前台，需要发送通知
        if (!isInForeground) {
            return true
        }
        
        // 如果 App 在前台，检查当前是否在 assistant 页面
        val url = currentUrl ?: return true
        val isAssistantPage = url.contains("assistant")
        
        // 如果在 assistant 页面，不发送通知
        return !isAssistantPage
    }
}

/**
 * MainActivity - 主 Activity
 *
 * 使用 GeckoView（Firefox 引擎）替代 WebView，解决各厂商 WebView 兼容性问题
 *
 * 重构后：
 * - UIHelper 负责所有 UI 显示逻辑
 * - ConsoleHook 负责 JavaScript console 捕获
 * - GeckoViewDelegateHandler 负责 GeckoView 代理回调
 * - MainActivity 作为协调者，实现 GeckoViewDelegateCallbacks 接口
 */
class MainActivity : AppCompatActivity(), GeckoViewDelegateCallbacks {

    // ========== UI 组件 ==========
    private lateinit var geckoView: GeckoView
    private lateinit var assetServer: AssetServer
    private lateinit var promptHandler: PromptHandler
    private lateinit var uiHelper: UIHelper
    
    // ========== GeckoView ==========
    private var geckoRuntime: GeckoRuntime? = null
    private var geckoSession: GeckoSession? = null
    private var canGoBack = false
    private var isDestroyed = false
    
    // ========== 辅助类 ==========
    private var snifferManager: SnifferManager? = null
    internal val debugBridge by lazy { DebugBridge(this) }

    /** 获取 SnifferManager 实例（供 SnifferBridgeHandler 使用） */
    fun getSnifferManager(): SnifferManager? = snifferManager
    private lateinit var delegateHandler: GeckoViewDelegateHandler
    
    // ========== 后台任务 ==========
    private lateinit var taskManager: TaskManager
    
    // ========== SGF 文件处理 ==========
    private var pendingSgfFile: File? = null  // 待处理的 SGF 文件
    private var pendingSharedText: String? = null  // 待处理的分享文本

    companion object {
        private const val TAG = "MainActivity"
        private val SERVER_URL: String get() = AppConfig.localServerUrl
        private val HOME_URL: String get() = AppConfig.homeUrl
    }

    // ========== 生命周期方法 ==========

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 全屏沉浸模式
        setupFullScreen()
        
        // 让内容延伸到刘海/挖孔区域
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        setContentView(R.layout.activity_main)

        // 初始化视图
        geckoView = findViewById(R.id.geckoView)
        geckoView.setBackgroundColor(Color.TRANSPARENT)
        
        // 初始化后台任务
        initTaskManager()
        
        // 初始化辅助类
        uiHelper = UIHelper(this)
        promptHandler = PromptHandler(this, lifecycleScope, taskManager)
        delegateHandler = GeckoViewDelegateHandler(this)
        
        // 注册 BridgeHandler（插件化桥接）
        registerBridgeHandlers()

        // 配置 GeckoView
        if (!setupGeckoView()) {
            uiHelper.showError("GeckoView 初始化失败，请重启应用")
            return
        }

        // 监听键盘高度变化，注入到 GeckoView 前端
        setupKeyboardInsetsListener()

        // 处理打开 SGF 文件的 Intent
        handleSgfIntent(intent)
        
        // 处理通知点击的 Intent
        handleNotificationIntent(intent)

        // 启动服务器并加载页面
        lifecycleScope.launch {
            startServerAndLoadPage()
        }
    }
    
    /**
     * 初始化后台任务调度器
     */
    private fun initTaskManager() {
        taskManager = TaskManager(applicationContext)
        Logger.i(TAG, "TaskManager initialized")
    }
    
    /**
     * 注册 BridgeHandler
     * 
     * 注册后，PromptHandler 会优先将桥接消息路由到对应的 Handler；
     * 如果未注册，则 fallback 到 PromptHandler 中的原有方法。
     * 这样保证了向后兼容。
     */
    private fun registerBridgeHandlers() {
        promptHandler.register(TaskBridgeHandler(this, lifecycleScope, taskManager))
        promptHandler.register(DebugBridgeHandler(this))
        promptHandler.register(FileBridgeHandler(this, lifecycleScope))
        promptHandler.register(SnifferBridgeHandler(this))
        promptHandler.register(ConsoleBridgeHandler(this))
        promptHandler.register(ClipboardBridgeHandler(this))
        promptHandler.register(KataGoBridgeHandler(this, lifecycleScope))
        promptHandler.register(ConfigBridgeHandler(this))
        Logger.i(TAG, "BridgeHandlers registered")
    }

    @Suppress("DEPRECATION")
    private fun setupFullScreen() {
        // 使用 setDecorFitsSystemWindows(false) 让内容延伸到系统栏下方
        // 同时保留 WindowInsets 正确分发（FLAG_LAYOUT_NO_LIMITS 会破坏 insets）
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // 状态栏和导航栏颜色设为透明（API 21+ 需要显式设置，API 35+ 已废弃但仍需兼容）
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT

        // 设置状态栏图标为浅色（白色）
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = false
        insetsController.isAppearanceLightNavigationBars = false
    }

    private var lastKeyboardHeight = 0  // 上次注入的键盘高度（CSS px），避免重复注入
    private var pendingDetailUrl: String? = null  // 待加载的详情页面 URL（从通知点击）

    /**
     * 监听键盘（IME）高度变化，通过 JS 注入到 GeckoView 前端
     *
     * GeckoView 不响应 adjustResize，visualViewport 事件也不触发，
     * 只能从原生侧检测键盘高度并通知前端。
     * 状态栏适配已改用 CSS env(safe-area-inset-top)，此处仅处理键盘。
     */
    private fun setupKeyboardInsetsListener() {
        val density = resources.displayMetrics.density

        // ===== 方式 1：WindowInsetsCompat =====
        val contentView = findViewById<android.view.View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(contentView) { _, insets ->
            val imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            val navHeight = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom

            val keyboardPx = maxOf(0, imeHeight - navHeight)
            val cssKeyboard = (keyboardPx / density).toInt()
            if (cssKeyboard != lastKeyboardHeight) {
                lastKeyboardHeight = cssKeyboard
                injectKeyboardHeight(cssKeyboard)
            }

            insets
        }

        // 方式 2 已禁用：与 WindowInsetsCompat 冲突，导致键盘弹起时误判
    }

    /** 将键盘高度（CSS px）注入到前端 */
    private fun injectKeyboardHeight(cssPx: Int) {
        geckoSession?.let { session ->
            val js = "if(window.onKeyboardHeightChange)window.onKeyboardHeightChange($cssPx)"
            session.loadUri("javascript:$js")
        }
    }
    
    /**
     * 发送消息到前端（通过 prompt）
     */
    fun sendToWeb(message: String) {
        geckoSession?.let { session ->
            val js = "if(window.onTaskComplete)window.onTaskComplete('$message')"
            session.loadUri("javascript:$js")
        }
    }
    internal fun injectTaskBridge() {
        Logger.i(TAG, "injectTaskBridge() called, geckoSession=$geckoSession")
        geckoSession?.let { session ->
            // 单行 JavaScript（GeckoView 不支持多行）
            val js = "if(!window.TaskBridge){window.TaskBridge={submitTask:function(t,p,o){var r=prompt('task:submit:'+JSON.stringify({type:t,params:p||{},pageUrl:o?.pageUrl||'',schedule:o?.schedule||''}));try{return JSON.parse(r)}catch(e){return{error:r}}},getStatus:function(i){var r=prompt('task:status:'+i);try{return JSON.parse(r)}catch(e){return{error:r}}},cancelTask:function(i){var r=prompt('task:cancel:'+i);try{return JSON.parse(r)}catch(e){return{error:r}}},getCompletedTasks:function(){var r=prompt('task:listCompleted:');try{return JSON.parse(r)}catch(e){return[]}},deleteTask:function(i){var r=prompt('task:delete:'+i);try{return JSON.parse(r)}catch(e){return{error:r}}}};console.log('TaskBridge injected')}"
            session.loadUri("javascript:$js")
            Logger.i(TAG, "TaskBridge JavaScript injected")
        }
    }
    
    internal fun injectDebugBridge() {
        Logger.i(TAG, "injectDebugBridge() called, geckoSession=$geckoSession")
        geckoSession?.let { session ->
            // 单行 JavaScript（GeckoView 不支持多行）
            val js = "if(!window.DebugBridge){window.DebugBridge={getFilesDir:function(){return prompt('debug:getFilesDir')},getCacheDir:function(){return prompt('debug:getCacheDir')},getFileSize:function(p){return prompt('debug:getFileSize:'+p)},clearCache:function(){return prompt('debug:clearCache')},getGeckoStorageSize:function(){return prompt('debug:getGeckoStorageSize')},refresh:function(){return prompt('debug:refresh')}};console.log('DebugBridge injected')}"
            Logger.i(TAG, "DebugBridge JavaScript injected")
        }
    }

    /**
     * 处理打开 SGF 文件或分享文本的 Intent
     * 
     * 支持以下场景：
     * 1. 从文件管理器打开 .sgf 文件（ACTION_VIEW）
     * 2. 从其他 App 分享文本/链接（ACTION_SEND）
     */
    /**
     * 处理通知点击的 Intent
     * 
     * 如果 Intent 中包含 detailUrl，保存到 pendingDetailUrl
     * 等服务器启动后再加载
     */
    private fun handleNotificationIntent(intent: Intent?) {
        val detailUrl = intent?.getStringExtra("detailUrl")
        
        if (detailUrl != null && detailUrl.isNotEmpty()) {
            // 构造完整的 URL
            pendingDetailUrl = if (detailUrl.startsWith("http")) {
                detailUrl
            } else {
                "$SERVER_URL$detailUrl"
            }
            
            Logger.i(TAG, "Pending detail URL from notification: $pendingDetailUrl")
        }
    }

    private fun handleSgfIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) {
            // 打开文件
            val uri = intent.data
            if (uri != null) {
                try {
                    pendingSgfFile = copySgfToCache(uri)
                } catch (e: Exception) {
                    Logger.e(TAG, "Failed to open SGF file", e)
                    uiHelper.showError("Cannot open file")
                }
            }
        } else if (intent?.action == Intent.ACTION_SEND) {
            // 分享文本
            if (intent.type == "text/plain") {
                val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (sharedText != null && sharedText.isNotEmpty()) {
                    pendingSharedText = sharedText
                }
            }
        }
    }

    /**
     * 将 SGF 文件复制到缓存目录
     * 
     * @param uri 文件 URI（可能是 content:// 或 file://）
     * @return 缓存文件
     */
    private fun copySgfToCache(uri: Uri): File {
        // 创建缓存目录
        val sgfCacheDir = File(cacheDir, "sgf-cache")
        if (!sgfCacheDir.exists()) {
            sgfCacheDir.mkdirs()
        }

        // 生成唯一的文件名（使用时间戳）
        val fileName = "sgf_${System.currentTimeMillis()}.sgf"
        val cacheFile = File(sgfCacheDir, fileName)

        // 复制文件内容
        contentResolver.openInputStream(uri)?.use { input ->
            cacheFile.outputStream().use { output ->
                input.copyTo(output)
            }
        } ?: throw Exception("Cannot open file: $uri")

        return cacheFile
    }

    /**
     * 处理后续的文件打开 Intent
     * 
     * 如果 Activity 已经在后台运行，用户再次打开 SGF 文件时，
     * Android 会调用 onNewIntent 而不是 onCreate。
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSgfIntent(intent)
        
        // 处理通知点击的 Intent
        handleNotificationIntent(intent)
        
        // 如果有待处理的 SGF 文件，重新加载页面
        if (pendingSgfFile != null) {
            loadSgfFile(pendingSgfFile!!)
        }
        
        // 如果有待处理的分享文本，发送给助手
        if (pendingSharedText != null) {
            sendTextToAssistant(pendingSharedText!!)
        }
    }

    /**
     * 加载 SGF 文件到助手
     * 
     * 读取 SGF 文件内容，跳转到 assistant 页面，并发送消息给助手。
     */
    private fun loadSgfFile(sgfFile: File) {
        try {
            // 读取 SGF 文件内容
            val sgfContent = sgfFile.readText()
            // 跳转到 assistant 页面
            geckoSession?.loadUri(HOME_URL)
            
            // 延迟后通过 JS 发送消息给助手
            Handler(Looper.getMainLooper()).postDelayed({
                sendSgfToAssistant(sgfContent, sgfFile.name)
            }, 2000)  // 延迟 2 秒，等待页面完全加载
            
            pendingSgfFile = null  // 清除待处理的文件
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to load SGF file", e)
            uiHelper.showError("Cannot read file")
        }
    }

    /**
     * 通过 JS 发送 SGF 内容给助手
     * 
     * 构造一条消息，包含 SGF 文件名和内容，发送给围棋 AI 助手。
     */
    private fun sendSgfToAssistant(sgfContent: String, fileName: String) {
        try {
            // 使用 Base64 编码 SGF 内容
            val encodedSgf = android.util.Base64.encodeToString(
                sgfContent.toByteArray(Charsets.UTF_8),
                android.util.Base64.NO_WRAP
            )
            
            // 使用简单的 ASCII 消息（避免编码问题）
            // 文件名如果有特殊字符，用 Base64 编码
            val encodedFileName = android.util.Base64.encodeToString(
                fileName.toByteArray(Charsets.UTF_8),
                android.util.Base64.NO_WRAP
            )
            
            val js = """
                (function() {
                    try {
                        const sgfBase64 = "$encodedSgf";
                        const fileNameBase64 = "$encodedFileName";
                        const sgfContent = atob(sgfBase64);
                        const fileName = atob(fileNameBase64);
                        
                        const message = "Opened SGF file: " + fileName + "\n\nSGF content:\n```sgf\n" + sgfContent + "\n```";
                        
                        console.log('[Android] SGF message prepared, length:', message.length);
                        console.log('[Android] File name:', fileName);
                        
                        if (window.assistantSendMessage) {
                            console.log('[Android] Calling assistantSendMessage');
                            window.assistantSendMessage(message);
                        } else {
                            console.error('[Android] assistantSendMessage not found');
                            const input = document.querySelector('textarea, input[type="text"]');
                            const sendBtn = document.querySelector('button[type="submit"], button.send, .send-button');
                            if (input && sendBtn) {
                                input.value = message;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                sendBtn.click();
                            }
                        }
                    } catch (e) {
                        console.error('[Android] Error sending SGF:', e);
                    }
                })();
            """.trimIndent()
            
            geckoSession?.loadUri("javascript:$js")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to send SGF to assistant", e)
            uiHelper.showError("Cannot send to assistant")
        }
    }

    /**
     * 通过 JS 发送分享文本给助手
     * 
     * 将其他 App 分享的文本内容发送给围棋 AI 助手。
     */
    private fun sendTextToAssistant(text: String) {
        try {
            // 使用 Base64 编码文本（避免特殊字符问题）
            val encodedText = android.util.Base64.encodeToString(
                text.toByteArray(Charsets.UTF_8),
                android.util.Base64.NO_WRAP
            )
            
            val js = """
                (function() {
                    try {
                        const textBase64 = "$encodedText";
                        const sharedText = atob(textBase64);
                        
                        const message = "Shared content:\n" + sharedText;
                        
                        console.log('[Android] Shared text prepared, length:', message.length);
                        
                        if (window.assistantSendMessage) {
                            console.log('[Android] Calling assistantSendMessage with shared text');
                            window.assistantSendMessage(message);
                        } else {
                            console.error('[Android] assistantSendMessage not found');
                            const input = document.querySelector('textarea, input[type="text"]');
                            const sendBtn = document.querySelector('button[type="submit"], button.send, .send-button');
                            if (input && sendBtn) {
                                input.value = message;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                sendBtn.click();
                            }
                        }
                    } catch (e) {
                        console.error('[Android] Error sending shared text:', e);
                    }
                })();
            """.trimIndent()
            
            geckoSession?.loadUri("javascript:$js")
            pendingSharedText = null  // 清除待处理的文本
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to send shared text to assistant", e)
            uiHelper.showError("Cannot send to assistant")
        }
    }

    override fun enterImmersiveMode() {
        // 全屏沉浸模式（隐藏系统栏，但保持键盘适配）
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun setupGeckoView(): Boolean {
        return try {
            geckoRuntime = WeiqiApp.getOrCreateRuntime(application as WeiqiApp)
            
            // 将 GeckoRuntime 传递给 DebugBridge（用于存储管理）
            DebugBridge.setGeckoRuntime(geckoRuntime!!)

            val session = GeckoSession()
            session.settings.setUserAgentOverride("WeiqiApp/1.0")
            geckoSession = session

            // 使用 GeckoViewDelegateHandler 设置所有代理
            delegateHandler.setupDelegates(session)

            session.open(geckoRuntime!!)
            geckoView.setSession(session)

            snifferManager = SnifferManager(applicationContext, geckoRuntime!!) { fn, json ->
                jsCallback(fn, json)
            }

            true
        } catch (e: Exception) {
            Logger.e(TAG, "setupGeckoView failed", e)
            false
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        promptHandler.onActivityResult(requestCode, resultCode, data)
    }

    private suspend fun startServerAndLoadPage() {
        uiHelper.showLoading("正在初始化", 0)

        withContext(Dispatchers.IO) {
            assetServer = AssetServer(applicationContext)

            assetServer.onDemandCallback = object : AssetServer.OnDemandCallback {
                override fun onDownloadStart(filename: String, sizeBytes: Long) {
                    val sizeHint = if (sizeBytes > 0) " (${UIHelper.formatSize(sizeBytes)})" else ""
                    uiHelper.showDownloadHint("下载中: $filename$sizeHint")
                }
                
                override fun onDownloadProgress(filename: String, loaded: Long, total: Long) {
                    val progress = if (total > 0) (loaded * 100 / total).toInt() else -1
                    val loadedText = UIHelper.formatSize(loaded)
                    val totalText = if (total > 0) UIHelper.formatSize(total) else ""
                    
                    val text = if (progress >= 0) {
                        "下载 $filename: $loadedText / $totalText ($progress%)"
                    } else {
                        "下载 $filename: $loadedText"
                    }
                    uiHelper.showDownloadHint(text)
                }
                
                override fun onDownloadComplete(filename: String) {
                    uiHelper.hideDownloadHint()
                }
            }

            assetServer.checkAndUpdateVersion(object : AssetServer.ProgressCallback {
                override fun onProgress(stage: String, progress: Int) {
                    uiHelper.showLoading(stage, progress)
                }
            })

            try {
                assetServer.start()
                Logger.i(TAG, "AssetServer started on port ${AssetServer.DEFAULT_PORT}")
            } catch (e: Exception) {
                Logger.e(TAG, "Failed to start AssetServer", e)
            }
        }

        uiHelper.showLoading("正在加载页面")
        
        // 如果有待加载的详情页面，优先加载
        val urlToLoad = pendingDetailUrl ?: HOME_URL
        geckoSession?.loadUri(urlToLoad)
        pendingDetailUrl = null  // 清除待加载的 URL

        // 注入 TaskBridge（延迟注入，确保页面环境就绪）
        Handler(Looper.getMainLooper()).postDelayed({
            injectTaskBridge()
            injectDebugBridge()  // 同时注入 DebugBridge
        }, 1000)  // 延迟 1 秒

        // 如果有待处理的 SGF 文件，延迟加载
        if (pendingSgfFile != null) {
            Handler(Looper.getMainLooper()).postDelayed({
                loadSgfFile(pendingSgfFile!!)
            }, 2000)  // 延迟 2 秒，等待页面加载完成
        }
        
        // 如果有待处理的分享文本，延迟发送
        if (pendingSharedText != null) {
            Handler(Looper.getMainLooper()).postDelayed({
                sendTextToAssistant(pendingSharedText!!)
            }, 2000)  // 延迟 2 秒，等待页面加载完成
        }
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (canGoBack && geckoSession != null) {
            geckoSession?.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        
        // 更新 App 状态：前台
        AppStateManager.setForeground(true)
        
        if (geckoSession != null && geckoRuntime != null && geckoSession?.isOpen == false) {
            geckoSession?.open(geckoRuntime!!)
        }
    }
    
    override fun onPause() {
        super.onPause()
        
        // 更新 App 状态：后台
        AppStateManager.setForeground(false)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // edge-to-edge 模式下，系统栏保持可见、半透明
    }

    override fun onDestroy() {
        isDestroyed = true
        try {
            assetServer.stop()
        } catch (e: Exception) {
            Logger.e(TAG, "Error stopping server", e)
        }
        snifferManager?.stopAll()
        geckoSession?.close()
        geckoSession = null
        super.onDestroy()
    }

    // ========== GeckoViewDelegateCallbacks 接口实现 ==========

    override fun getActivity(): Activity = this

    override fun getPromptHandler(): PromptHandler = promptHandler

    override fun getUIHelper(): UIHelper = uiHelper

    override fun getServerUrl(): String = SERVER_URL

    override fun getHomeUrl(): String = HOME_URL

    override fun getGeckoRuntime(): GeckoRuntime? = geckoRuntime

    override fun getGeckoSession(): GeckoSession? = geckoSession

    override fun setGeckoSession(session: GeckoSession) {
        geckoSession = session
    }

    override fun setCanGoBack(canGoBack: Boolean) {
        this.canGoBack = canGoBack
    }

    override fun openExternalUrl(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            startActivity(intent)
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to open external URL: $url", e)
        }
    }

    override fun setSessionToView(session: GeckoSession) {
        geckoView.setSession(session)
    }

    override fun jsCallback(fn: String, json: String) {
        val escaped = json
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
        geckoSession?.loadUri("javascript:if(window.$fn) window.$fn('$escaped')")
    }

    // ========== Sniffer 协议处理 ==========

    override fun handleSnifferUri(uri: String) {
        try {
            val parsed = android.net.Uri.parse(uri)
            
            // 数据上报：sniffer://ws?data=...（忽略，由 WebExtension 直接处理）
            if (parsed.host == "ws") {
                return
            }
            
            // 所有控制命令统一由 SnifferManager 处理
            val handled = snifferManager?.handleSnifferUri(uri) ?: false
            if (handled) {
                when (parsed.host) {
                    "start" -> {
                        val id = parsed.getQueryParameter("id") ?: ""
                        jsCallback("onSnifferResult", """{"action":"started","data":"$id"}""")
                    }
                    "stop" -> {
                        val id = parsed.getQueryParameter("id") ?: ""
                        jsCallback("onSnifferResult", """{"action":"stopped","data":"$id"}""")
                    }
                    "flush" -> {
                        val id = parsed.getQueryParameter("id") ?: ""
                        jsCallback("onSnifferResult", """{"action":"flushed","data":"$id"}""")
                    }
                    "status" -> {
                        val ids = snifferManager?.getRunningIds()?.joinToString(",") ?: ""
                        jsCallback("onSnifferResult", """{"action":"status","data":"$ids"}""")
                    }
                }
            } else {
                Logger.w(TAG, "Sniffer URI not handled: $uri")
            }
        } catch (e: Exception) {
            jsCallback("onSnifferResult", """{"action":"error","data":"${e.message}"}""")
        }
    }
}
