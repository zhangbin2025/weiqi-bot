package com.weiqi.app.geckoview

import android.os.Handler
import android.os.Looper
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.weiqi.app.console.ConsoleHook
import com.weiqi.app.util.Logger
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * GeckoViewDelegateHandler - GeckoView 代理处理器
 *
 * 职责：
 * 1. 处理导航事件（NavigationDelegate）
 * 2. 处理加载进度（ProgressDelegate）
 * 3. 处理内容事件（ContentDelegate）
 * 4. 处理弹窗事件（PromptDelegate）
 * 5. 处理权限请求（PermissionDelegate）
 *
 * 协议桥接（通过 prompt）：
 * - sniffer://  → 抓包控制
 * - debug:      → 调试命令
 * - console:    → 日志捕获
 * - clipboard:  → 原生剪贴板读取（clipboard:read）
 */
class GeckoViewDelegateHandler(
    private val callbacks: GeckoViewDelegateCallbacks
) {
    companion object {
        private const val TAG = "GeckoViewDelegate"
    }
    
    /**
     * 为 GeckoSession 设置所有代理
     */
    fun setupDelegates(session: GeckoSession) {
        setupNavigationDelegate(session)
        setupProgressDelegate(session)
        setupContentDelegate(session)
        setupPromptDelegate(session)
        setupPermissionDelegate(session)
    }
    
    /**
     * 设置导航代理
     */
    private fun setupNavigationDelegate(session: GeckoSession) {
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: List<GeckoSession.PermissionDelegate.ContentPermission>,
                isUserGesture: Boolean
            ) {
                Logger.d(TAG, "Location changed: $url (userGesture=$isUserGesture)")
                
                // 更新当前 URL 到 AppStateManager
                com.weiqi.app.AppStateManager.setCurrentUrl(url)
            }
            
            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                callbacks.setCanGoBack(canGoBack)
            }
            
            override fun onCanGoForward(session: GeckoSession, canGoForward: Boolean) {}
            
            override fun onLoadRequest(
                session: GeckoSession,
                request: GeckoSession.NavigationDelegate.LoadRequest
            ): GeckoResult<AllowOrDeny>? {
                val uri = request.uri
                // Logger.d(TAG, "Load request: $uri") // 注释掉，避免刷屏
                
                // 拦截 sniffer:// 协议，异步处理避免阻塞主页面
                if (uri.startsWith("sniffer://")) {
                    Handler(Looper.getMainLooper()).post { callbacks.handleSnifferUri(uri) }
                    return GeckoResult.deny()
                }
                
                // 站外链接用系统浏览器打开
                if (uri.startsWith("http://") || uri.startsWith("https://")) {
                    if (!uri.startsWith(callbacks.getServerUrl()) && !uri.startsWith("localhost:")) {
                        try {
                            callbacks.openExternalUrl(uri)
                        } catch (e: Exception) {
                            Logger.e(TAG, "Failed to open external URL: $uri", e)
                        }
                        return GeckoResult.deny()
                    }
                }
                
                return GeckoResult.allow()
            }
        }
    }
    
    /**
     * 设置进度代理
     */
    private fun setupProgressDelegate(session: GeckoSession) {
        session.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                callbacks.getUIHelper().showLoading("加载中...")
            }
            
            override fun onPageStop(session: GeckoSession, success: Boolean) {
                if (success) {
                    callbacks.getUIHelper().hideLoading()
                    // 标记原生环境，让前端知道运行在 GeckoView 中
                    session.loadUri("javascript:window.__weiqi_native=true")
                    // 隐藏 GeckoView 粘贴浮动按钮（CSS 方式，pref API 在 GV 151 中不可用）
                    // 该按钮在输入框获焦且剪贴板有内容时自动弹出，影响体验
                    session.loadUri("javascript:(function(){var s=document.createElement('style');s.textContent='[anonid=\"paste\"],.moz-paste-button,moz-input-paste{display:none!important}';document.head.appendChild(s);})()")
                    // 注入 console hook 脚本
                    ConsoleHook.inject { script ->
                        callbacks.getGeckoSession()?.loadUri(script)
                    }
                }
            }
        }
    }
    
    /**
     * 设置内容代理
     */
    private fun setupContentDelegate(session: GeckoSession) {
        session.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onTitleChange(session: GeckoSession, title: String?) {}
            
            override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) {
                if (fullScreen) {
                    callbacks.enterImmersiveMode()
                } else {
                    // 退出全屏时恢复系统栏
                    val controller = WindowInsetsControllerCompat(callbacks.getActivity().window, callbacks.getActivity().window.decorView)
                    controller.show(WindowInsetsCompat.Type.systemBars())
                }
            }
            
            override fun onExternalResponse(
                session: GeckoSession,
                response: org.mozilla.geckoview.WebResponse
            ) {
                callbacks.getPromptHandler().onExternalResponse(
                    response,
                    { msg -> callbacks.getUIHelper().showDownloadHint(msg) },
                    { callbacks.getUIHelper().hideDownloadHint() }
                )
            }
            
            override fun onCrash(session: GeckoSession) {
                callbacks.getGeckoSession()?.close()
                val newSession = org.mozilla.geckoview.GeckoSession()
                callbacks.setGeckoSession(newSession)
                
                // 重新设置代理
                setupDelegates(newSession)
                setupPromptDelegate(newSession)
                
                try {
                    newSession.open(callbacks.getGeckoRuntime()!!)
                    callbacks.setSessionToView(newSession)
                    newSession.loadUri(callbacks.getHomeUrl())
                } catch (e: Exception) {
                    callbacks.getUIHelper().showError("页面崩溃，请重启应用")
                }
            }
            
            override fun onKill(session: GeckoSession) {
                callbacks.getUIHelper().showError("页面被终止，请重启应用")
            }
        }
    }
    
    /**
     * 设置权限代理
     *
     * 处理剪贴板读取权限等，让 navigator.clipboard.readText() 在 GeckoView 中可用
     */
    private fun setupPermissionDelegate(session: GeckoSession) {
        session.permissionDelegate = object : GeckoSession.PermissionDelegate {
            override fun onAndroidPermissionsRequest(
                session: GeckoSession,
                permissions: Array<String>?,
                callback: GeckoSession.PermissionDelegate.Callback
            ) {
                // 允许剪贴板读取权限
                if (permissions?.contains("android.permission.READ_CLIPBOARD") == true) {
                    Logger.d(TAG, "Granting READ_CLIPBOARD permission")
                    callback.grant()
                    return
                }
                // 其他权限默认拒绝
                callback.reject()
            }

            override fun onContentPermissionRequest(
                session: GeckoSession,
                perm: GeckoSession.PermissionDelegate.ContentPermission
            ): GeckoResult<Int>? {
                Logger.d(TAG, "Content permission request: ${perm.permission}")
                // 敏感权限（地理位置等）默认拒绝，其他允许
                val denyPermissions = setOf(
                    org.mozilla.geckoview.GeckoSession.PermissionDelegate.PERMISSION_GEOLOCATION,
                    org.mozilla.geckoview.GeckoSession.PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS,
                )
                return if (perm.permission in denyPermissions) {
                    GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
                } else {
                    GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW)
                }
            }

            override fun onMediaPermissionRequest(
                session: GeckoSession,
                uri: String,
                video: Array<GeckoSession.PermissionDelegate.MediaSource>?,
                audio: Array<GeckoSession.PermissionDelegate.MediaSource>?,
                callback: GeckoSession.PermissionDelegate.MediaCallback
            ) {
                callback.reject()
            }
        }
    }

    /**
     * 设置弹窗代理
     *
     * 同时处理 JS→原生的协议桥接（debug:, sniffer://, console:, clipboard: 均由 PromptHandler 注册表路由）
     */
    private fun setupPromptDelegate(session: GeckoSession) {
        session.promptDelegate = object : GeckoSession.PromptDelegate {
            override fun onButtonPrompt(
                session: GeckoSession,
                prompt: GeckoSession.PromptDelegate.ButtonPrompt
            ) = callbacks.getPromptHandler().onButtonPrompt(prompt)
            
            override fun onAlertPrompt(
                session: GeckoSession,
                prompt: GeckoSession.PromptDelegate.AlertPrompt
            ) = callbacks.getPromptHandler().onAlertPrompt(prompt)
            
            override fun onTextPrompt(
                session: GeckoSession,
                prompt: GeckoSession.PromptDelegate.TextPrompt
            ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
                return callbacks.getPromptHandler().onTextPrompt(prompt)
            }
            
            override fun onChoicePrompt(
                session: GeckoSession,
                prompt: GeckoSession.PromptDelegate.ChoicePrompt
            ) = callbacks.getPromptHandler().onChoicePrompt(prompt)
            
            override fun onFilePrompt(
                session: GeckoSession,
                prompt: GeckoSession.PromptDelegate.FilePrompt
            ) = callbacks.getPromptHandler().onFilePrompt(prompt)
        }
    }
}
