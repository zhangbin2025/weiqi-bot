package com.weiqi.app
import com.weiqi.app.WeiqiApp

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
    
    fun shouldSendNotification(): Boolean {
        if (!isInForeground) {
            return true
        }
        
        val url = currentUrl ?: return true
        val isAssistantPage = url.contains("assistant")
        
        return !isAssistantPage
    }
}

class MainActivity : AppCompatActivity(), GeckoViewDelegateCallbacks {

    private lateinit var geckoView: GeckoView
    private lateinit var assetServer: AssetServer
    private lateinit var promptHandler: PromptHandler
    private lateinit var uiHelper: UIHelper
    
    private var geckoRuntime: GeckoRuntime? = null
    private var geckoSession: GeckoSession? = null
    private var canGoBack = false
    private var isDestroyed = false
    
    private var snifferManager: SnifferManager? = null
    internal val debugBridge by lazy { DebugBridge(this) }

    fun getSnifferManager(): SnifferManager? = snifferManager
    private lateinit var delegateHandler: GeckoViewDelegateHandler
    
    private lateinit var taskManager: TaskManager
    
    private var pendingSgfFile: File? = null
    private var pendingSharedText: String? = null

    private var lastLoadedUrl: String? = null

    companion object {
        private const val TAG = "MainActivity"
        private val SERVER_URL: String get() = AppConfig.localServerUrl
        private val HOME_URL: String get() = AppConfig.homeUrl
        private const val KEY_LAST_URL = "lastLoadedUrl"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        lastLoadedUrl = savedInstanceState?.getString(KEY_LAST_URL)

        setupFullScreen()
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        setContentView(R.layout.activity_main)

        geckoView = findViewById(R.id.geckoView)
        geckoView.setBackgroundColor(Color.TRANSPARENT)
        
        initTaskManager()
        
        uiHelper = UIHelper(this)
        promptHandler = PromptHandler(this, lifecycleScope, taskManager)
        delegateHandler = GeckoViewDelegateHandler(this)
        
        registerBridgeHandlers()

        if (!setupGeckoView()) {
            uiHelper.showError("GeckoView 初始化失败，请重启应用")
            return
        }

        setupKeyboardInsetsListener()

        handleSgfIntent(intent)
        
        handleNotificationIntent(intent)

        lifecycleScope.launch {
            startServerAndLoadPage()
        }
    }
    
    private fun initTaskManager() {
        taskManager = TaskManager(applicationContext)
        Logger.i(TAG, "TaskManager initialized")
    }
    
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
        WindowCompat.setDecorFitsSystemWindows(window, false)

        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = false
        insetsController.isAppearanceLightNavigationBars = false
    }

    private var lastKeyboardHeight = 0
    private var pendingDetailUrl: String? = null

    private fun setupKeyboardInsetsListener() {
        val density = resources.displayMetrics.density

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
    }

    private fun injectKeyboardHeight(cssPx: Int) {
        geckoSession?.let { session ->
            val js = "if(window.onKeyboardHeightChange)window.onKeyboardHeightChange($cssPx)"
            session.loadUri("javascript:$js")
        }
    }
    
    fun sendToWeb(message: String) {
        geckoSession?.let { session ->
            val js = "if(window.onTaskComplete)window.onTaskComplete('$message')"
            session.loadUri("javascript:$js")
        }
    }
    
    internal fun injectTaskBridge() {
        Logger.i(TAG, "injectTaskBridge() called, geckoSession=$geckoSession")
        geckoSession?.let { session ->
            val js = "if(!window.TaskBridge){window.TaskBridge={submitTask:function(t,p,o){var r=prompt('task:submit:'+JSON.stringify({type:t,params:p||{},pageUrl:o?.pageUrl||'',schedule:o?.schedule||''}));try{return JSON.parse(r)}catch(e){return{error:r}}},getStatus:function(i){var r=prompt('task:status:'+i);try{return JSON.parse(r)}catch(e){return{error:r}}},cancelTask:function(i){var r=prompt('task:cancel:'+i);try{return JSON.parse(r)}catch(e){return{error:r}}},getCompletedTasks:function(){var r=prompt('task:listCompleted:');try{return JSON.parse(r)}catch(e){return[]}},deleteTask:function(i){var r=prompt('task:delete:'+i);try{return JSON.parse(r)}catch(e){return{error:r}}}};console.log('TaskBridge injected')}"
            session.loadUri("javascript:$js")
            Logger.i(TAG, "TaskBridge JavaScript injected")
        }
    }
    
    internal fun injectDebugBridge() {
        Logger.i(TAG, "injectDebugBridge() called, geckoSession=$geckoSession")
        geckoSession?.let { session ->
            val js = "if(!window.DebugBridge){window.DebugBridge={getFilesDir:function(){return prompt('debug:getFilesDir')},getCacheDir:function(){return prompt('debug:getCacheDir')},getFileSize:function(p){return prompt('debug:getFileSize:'+p)},clearCache:function(){return prompt('debug:clearCache')},getGeckoStorageSize:function(){return prompt('debug:getGeckoStorageSize')},refresh:function(){return prompt('debug:refresh')}};console.log('DebugBridge injected')}"
            Logger.i(TAG, "DebugBridge JavaScript injected")
        }
    }

    private fun handleNotificationIntent(intent: Intent?) {
        val detailUrl = intent?.getStringExtra("detailUrl")
        
        if (detailUrl != null && detailUrl.isNotEmpty()) {
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
            if (intent.type == "text/plain") {
                val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (sharedText != null && sharedText.isNotEmpty()) {
                    pendingSharedText = sharedText
                }
            }
        }
    }

    private fun copySgfToCache(uri: Uri): File {
        val sgfCacheDir = File(cacheDir, "sgf-cache")
        if (!sgfCacheDir.exists()) {
            sgfCacheDir.mkdirs()
        }

        val fileName = "sgf_${System.currentTimeMillis()}.sgf"
        val cacheFile = File(sgfCacheDir, fileName)

        contentResolver.openInputStream(uri)?.use { input ->
            cacheFile.outputStream().use { output ->
                input.copyTo(output)
            }
        } ?: throw Exception("Cannot open file: $uri")

        return cacheFile
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSgfIntent(intent)
        
        handleNotificationIntent(intent)
        
        // 如果有 pendingDetailUrl，立即加载页面
        val url = pendingDetailUrl
        if (url != null) {
            geckoSession?.loadUri(url)
            lastLoadedUrl = url
            pendingDetailUrl = null
        }
        
        if (pendingSgfFile != null) {
            loadSgfFile(pendingSgfFile!!)
        }
        
        if (pendingSharedText != null) {
            sendTextToAssistant(pendingSharedText!!)
        }
    }

    private fun loadSgfFile(sgfFile: File) {
        try {
            val sgfContent = sgfFile.readText()
            geckoSession?.loadUri(HOME_URL)
            
            Handler(Looper.getMainLooper()).postDelayed({
                sendSgfToAssistant(sgfContent, sgfFile.name)
            }, 2000)
            
            pendingSgfFile = null
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to load SGF file", e)
            uiHelper.showError("Cannot read file")
        }
    }

    private fun sendSgfToAssistant(sgfContent: String, fileName: String) {
        try {
            val encodedSgf = android.util.Base64.encodeToString(
                sgfContent.toByteArray(Charsets.UTF_8),
                android.util.Base64.NO_WRAP
            )
            
            val encodedFileName = android.util.Base64.encodeToString(
                fileName.toByteArray(Charsets.UTF_8),
                android.util.Base64.NO_WRAP
            )
            
            val js = """
                (function() {
                    try {
                        const sgfBase64 = "$encodedSgf";
                        const fileNameBase64 = "$encodedFileName";
                        const sgfBytes = Uint8Array.from(atob(sgfBase64), c => c.charCodeAt(0));
                        const sgfContent = new TextDecoder("utf-8").decode(sgfBytes);
                        const fileNameBytes = Uint8Array.from(atob(fileNameBase64), c => c.charCodeAt(0));
                        const fileName = new TextDecoder("utf-8").decode(fileNameBytes);
                        
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

    private fun sendTextToAssistant(text: String) {
        try {
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
            pendingSharedText = null
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to send shared text to assistant", e)
            uiHelper.showError("Cannot send to assistant")
        }
    }

    override fun enterImmersiveMode() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun setupGeckoView(): Boolean {
        return try {
            geckoRuntime = WeiqiApp.getOrCreateRuntime(application as WeiqiApp)
            
            DebugBridge.setGeckoRuntime(geckoRuntime!!)

            val session = GeckoSession()
            session.settings.setUserAgentOverride("WeiqiApp/1.0")
            geckoSession = session

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
        // ========== 阶段1：启动服务器 ==========
        uiHelper.showLoading("正在初始化", 0)

        // 使用单例 AssetServer，避免端口冲突
        assetServer = WeiqiApp.getOrCreateAssetServer(application)

        // ========== 阶段2：预下载资源（阻塞页面显示，带进度） ==========
        // 预下载时不触发 onDemandCallback（避免底部 toast 干扰加载界面）
        assetServer.onDemandCallback = null
        
        withContext(Dispatchers.IO) {
            try {
                assetServer.checkAndUpdateVersion(object : AssetServer.ProgressCallback {
                    override fun onProgress(stage: String, progress: Int) {
                        uiHelper.showLoading(stage, progress)
                    }
                })
                Logger.i(TAG, "Preload complete")
            } catch (e: Exception) {
                Logger.e(TAG, "Preload failed", e)
            }
        }
        
        uiHelper.hideLoading()
        
        // 预下载完成后，启用 onDemandCallback（用于运行时按需下载）
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
        
        // ========== 阶段3：显示页面 ==========
        val urlToLoad = pendingDetailUrl ?: lastLoadedUrl ?: HOME_URL
        lastLoadedUrl = urlToLoad
        geckoSession?.loadUri(urlToLoad)
        pendingDetailUrl = null

        Handler(Looper.getMainLooper()).postDelayed({
            injectTaskBridge()
            injectDebugBridge()
        }, 1000)

        if (pendingSgfFile != null) {
            Handler(Looper.getMainLooper()).postDelayed({
                loadSgfFile(pendingSgfFile!!)
            }, 2000)
        }
        
        if (pendingSharedText != null) {
            Handler(Looper.getMainLooper()).postDelayed({
                sendTextToAssistant(pendingSharedText!!)
            }, 2000)
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
        
        AppStateManager.setForeground(true)
        
        // 检查所有调度，看是否需要立即执行
        taskManager.checkAllAndExecute()
        
        if (geckoSession != null && geckoRuntime != null) {
            if (geckoSession?.isOpen == false) {
                try {
                    geckoSession?.open(geckoRuntime!!)
                    val urlToLoad = lastLoadedUrl ?: HOME_URL
                    geckoSession?.loadUri(urlToLoad)
                } catch (e: Exception) {
                    Logger.e(TAG, "Failed to reopen session", e)
                }
            } else {
                geckoSession?.loadUri("javascript:void(0)")
            }
        }
    }
    
    override fun onPause() {
        super.onPause()
        
        AppStateManager.setForeground(false)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val urlToSave = AppStateManager.currentUrl ?: lastLoadedUrl
        if (urlToSave != null) {
            outState.putString(KEY_LAST_URL, urlToSave)
        }
    }

    override fun onDestroy() {
        isDestroyed = true
        // AssetServer 由 WeiqiApp 单例管理，不在这里 stop
        /* try {
            assetServer.stop()
        } catch (e: Exception) {
            Logger.e(TAG, "Error stopping server", e)
        } */
        snifferManager?.stopAll()
        geckoSession?.close()
        geckoSession = null
        super.onDestroy()
    }

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

    override fun handleSnifferUri(uri: String) {
        try {
            val parsed = android.net.Uri.parse(uri)
            
            if (parsed.host == "ws") {
                return
            }
            
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
