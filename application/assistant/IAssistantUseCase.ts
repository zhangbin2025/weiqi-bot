/**
 * AI 助手用例接口
 * @module application/assistant/IAssistantUseCase
 */
/**
 * 意图识别结果
 */
export interface IntentRecognizeResult {
  /** 识别出的意图 */
  intent: string;
  /** 置信度 */
  confidence: number;
  /** 参数 */
  params: Record<string, any>;
  /** 候选意图 */
  alternatives?: Array<{ intent: string; confidence: number }>;
  /** 响应类型 */
  responseType?: 'foreground' | 'periodic' | 'background';
}
/**
 * AI 助手用例接口
 * 协调意图识别、实体提取、跳转决策等模块
 */
export interface IAssistantUseCase {
  /**
   * 发送消息
   * @param text 用户输入文本
   * @returns Promise<void>
   * 
   * @ai-example
   * ```typescript
   * await useCase.sendMessage('下载柯洁的棋谱');
   * ```
   */
  sendMessage(text: string): Promise<void>;
  /**
   * 新建会话
   */
  newSession(): Promise<void>;
  /**
   * 显示历史记录
   */
  showHistory(): Promise<void>;
  /**
   * 清空所有历史
   */
  clearAllHistory(): Promise<void>;
  /**
   * 导出历史记录
   */
  exportHistory(): Promise<void>;
  /**
   * 初始化
   */
  init(): Promise<void>;
}
