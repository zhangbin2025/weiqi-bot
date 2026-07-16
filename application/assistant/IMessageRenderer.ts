/**
 * 消息渲染器接口
 * @module application/assistant/IMessageRenderer
 */
import type { IntentConfig } from '../../domain/intent/intent-config';
/**
 * 消息渲染器接口
 * 由表现层实现，用于渲染消息到 UI
 */
export interface IMessageRenderer {
  /**
   * 渲染消息
   * @param text 消息文本
   * @param isUser 是否为用户消息
   * @param intent 意图（可选）
   * @param entities 实体（可选）
   * @param actionUrl 跳转 URL（可选）
   * @param actionText 按钮文本（可选）
   * @param useTypewriter 是否使用打字机效果
   * @param taskId 任务 ID（可选）
   */
  renderMessage(
    text: string,
    isUser: boolean,
    intent?: string | null,
    entities?: Record<string, any> | null,
    actionUrl?: string,
    actionText?: string,
    useTypewriter?: boolean,
    taskId?: string
  ): Promise<void>;
  /**
   * 清空所有消息
   */
  clearMessages(): void;
  /**
   * 显示打字状态
   */
  showTyping(): void;
  /**
   * 隐藏打字状态
   */
  hideTyping(): void;
  /**
   * 显示倒计时跳转
   * @param jumpUrl 跳转 URL
   * @param countdown 倒计时秒数
   * @param onCancel 取消回调
   */
  showCountdownJump(jumpUrl: string, countdown: number, onCancel: () => void): void;
}
