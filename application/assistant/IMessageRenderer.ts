/**
 * 消息渲染器接口
 * @module application/assistant/IMessageRenderer
 */
import type { IntentConfig } from '../../domain/intent/intent-config';
import type { PluginTraceStep } from '../../domain/plugin/types';
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
   * @param timestamp 时间戳（可选）
   * @param variant 消息变体：'chat' 表示闲聊回复，渲染器会套用专属气泡样式；
   *                不传则保持默认（功能消息 / 带意图标签的消息）
   */
  renderMessage(
    text: string,
    isUser: boolean,
    intent?: string | null,
    entities?: Record<string, any> | null,
    actionUrl?: string,
    actionText?: string,
    useTypewriter?: boolean,
    taskId?: string,
    timestamp?: number,
    variant?: 'chat'
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
  /**
   * 全量渲染「插件调试过程」的可折叠日志（可选实现，兼容旧行为）。
   *
   * 纯展示、不写入会话历史；表现层必须全程用 textContent 构造，
   * 禁止把步骤文本交给 marked/innerHTML。
   */
  renderPluginTrace?(steps: PluginTraceStep[]): Promise<void>;

  // ---------- 实时过程日志（可选实现，优先于全量渲染） ----------
  /**
   * 开启一个实时过程块。必须在任何 append 之前调用；重复调用视为开启新一轮。
   * 返回 false 表示渲染器不支持实时模式，调用方应回退到全量 renderPluginTrace。
   */
  beginPluginTrace?(): boolean;
  /** 实时追加一步（步骤产生时立刻调用），逐步出现在折叠块里 */
  appendPluginTraceStep?(step: PluginTraceStep): void;
  /** 收尾：更新标题为最终状态、停止进行中动画 */
  finishPluginTrace?(ok: boolean): void;
}
