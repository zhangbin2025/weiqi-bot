package com.weiqi.app.bridge

import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/**
 * BridgeHandler - 桥接处理器接口
 *
 * 插件化设计：每个模块独立处理特定前缀的消息。
 * 新增接口只需新增 Handler，不影响已有代码。
 */
interface BridgeHandler {
    /**
     * 消息前缀，如 "task:", "debug:"
     * onTextPrompt 根据此值做路由
     */
    val prefix: String

    /**
     * 处理桥接消息
     *
     * @param prompt GeckoView TextPrompt
     * @param message 完整消息内容（含前缀，如 "task:submit:{...}"）
     * @return 响应结果，或 null 表示不处理
     */
    fun handle(
        prompt: GeckoSession.PromptDelegate.TextPrompt,
        message: String
    ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>?
}
