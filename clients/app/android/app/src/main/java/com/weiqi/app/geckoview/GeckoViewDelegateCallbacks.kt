package com.weiqi.app.geckoview

import android.app.Activity
import com.weiqi.app.PromptHandler
import com.weiqi.app.ui.UIHelper
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession

/**
 * GeckoViewDelegateCallbacks - GeckoView 代理回调接口
 *
 * MainActivity 实现此接口，提供给 GeckoViewDelegateHandler 使用
 */
interface GeckoViewDelegateCallbacks {
    
    /** 获取 Activity 引用 */
    fun getActivity(): Activity
    
    /** 进入沉浸模式 */
    fun enterImmersiveMode()
    
    /** 处理 sniffer:// 协议（导航拦截 + prompt 都会调用） */
    fun handleSnifferUri(uri: String)
    
    /** JavaScript 回调 */
    fun jsCallback(fn: String, json: String)
    
    /** 获取 PromptHandler */
    fun getPromptHandler(): PromptHandler
    
    /** 获取 UIHelper */
    fun getUIHelper(): UIHelper
    
    /** 获取服务器 URL */
    fun getServerUrl(): String
    
    /** 获取首页 URL */
    fun getHomeUrl(): String
    
    /** 获取 GeckoRuntime */
    fun getGeckoRuntime(): GeckoRuntime?
    
    /** 获取 GeckoSession */
    fun getGeckoSession(): GeckoSession?
    
    /** 设置 GeckoSession */
    fun setGeckoSession(session: GeckoSession)
    
    /** 设置是否可以后退 */
    fun setCanGoBack(canGoBack: Boolean)
    
    /** 打开外部链接 */
    fun openExternalUrl(url: String)
    
    /** 设置 GeckoSession 到 GeckoView */
    fun setSessionToView(session: GeckoSession)
}
