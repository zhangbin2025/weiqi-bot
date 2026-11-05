/**
 * 对话用例
 * @module application/chat/ChatUseCase
 *
 * 职责单一：处理一条用户消息 —— 渲染、写历史、拼上下文、调模型网关、渲染回复。
 * 不碰意图识别、跳转、命令体系、凭据配置。
 * 会话管理与 UI 装配由表现层 ChatPage 负责。
 */

import type { IModelGateway } from '../model/IModelGateway';
import type { ChatHistoryManager } from '../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../assistant/IMessageRenderer';
import { buildConversationMessages, summarizeSession } from './ConversationPrompt';

/** 拦截「/」开头：chat 页零命令体系，配置请回功能助手 */
export const SLASH_COMMAND_HINT = '对话页不支持命令，模型配置请回到功能助手操作。';
export const NOT_READY_HINT = '尚未配置 LLM，请回到功能助手执行 /llm 配置后再来对话。';

export function isSlashCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

export class ChatUseCase {
  constructor(
    private readonly gateway: IModelGateway,
    private readonly history: ChatHistoryManager,
    private readonly renderer: IMessageRenderer,
  ) {}

  isReady(): boolean {
    return this.gateway.isReady();
  }

  /**
   * 发送一条用户消息。
   *
   * 安全边界：
   * - 「/」开头只渲染提示，不渲染用户气泡、不写历史 —— 避免 /llm 里的
   *   apiKey 明文落进 IndexedDB 并出现在导出文件里。
   * - 模型失败时只渲染错误提示、**不写进历史**，否则错误文案会在下一轮
   *   被当上下文带进去污染对话。用户消息本身仍保留（用户确实发了）。
   */
  async send(text: string): Promise<void> {
    if (isSlashCommand(text)) {
      await this.renderHint(SLASH_COMMAND_HINT);
      return;
    }
    if (!this.gateway.isReady()) {
      await this.renderHint(NOT_READY_HINT);
      return;
    }

    // 用户气泡 + 落盘
    await this.renderer.renderMessage(text, true, null, null, undefined, undefined, false);
    await this.history.addMessage({ role: 'user', content: text });
    // 首条消息生成会话摘要/标题（用户要求：第一条消息截断）
    if (this.history.getMessages().filter((m) => m.role === 'user').length === 1) {
      await this.history.setCurrentSessionTitle(summarizeSession(this.history.getMessages()));
    }

    this.renderer.showTyping();
    try {
      // getMessages() 已含当前句，不再额外追加 user 消息
      const messages = buildConversationMessages(this.history.getMessages());
      const result = await this.gateway.execute({
        task: 'chat.reply',
        messages,
        options: { jsonMode: false },
      });
      this.renderer.hideTyping();
      if (!result.text.trim()) {
        await this.renderHint('模型没有返回内容，请稍后重试或更换模型。');
        return;
      }
      await this.renderer.renderMessage(
        result.text, false, null, null, undefined, undefined, true,
      );
      await this.history.addMessage({ role: 'assistant', content: result.text });
    } catch (error) {
      this.renderer.hideTyping();
      const message = error instanceof Error ? error.message : String(error);
      await this.renderHint(`❌ 对话失败：${message}`);
    }
  }

  /** 提示类消息：只渲染，绝不写历史 */
  private async renderHint(text: string): Promise<void> {
    await this.renderer.renderMessage(
      text, false, null, null, undefined, undefined, false,
    );
  }
}
