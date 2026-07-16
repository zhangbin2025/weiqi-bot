// AIController.ts - AI 控制器
import type { ILLMClient } from '../../infrastructure/utils/llm/types';
import { FunctionRegistry } from './FunctionRegistry';
import { IntentProcessor } from './IntentProcessor';
import { TaskOrchestrator } from './TaskOrchestrator';
import type { AIResponse, UserIntent } from './types';
import type { ILogger } from '../../infrastructure/logger/types';
/** AI 控制器配置 */
export interface AIControllerConfig {
  llmClient: ILLMClient;
  registry: FunctionRegistry;
  orchestrator: TaskOrchestrator;
  logger: ILogger;
}
/**
 * AI 控制器
 * 负责对话处理、意图识别和任务执行
 */
export class AIController {
  private registry: FunctionRegistry;
  private intentProcessor: IntentProcessor;
  private orchestrator: TaskOrchestrator;
  private logger: ILogger;

  constructor(config: AIControllerConfig) {
    this.registry = config.registry;
    this.orchestrator = config.orchestrator;
    this.logger = config.logger;
    this.intentProcessor = new IntentProcessor(config.llmClient, this.logger);
  }
  /**
   * 对话处理
   */
  async chat(message: string, userId: string): Promise<AIResponse> {
    const intent = await this.intentProcessor.process(message);
    if (intent.confidence < 0.5) {
      console.debug(`Low confidence intent: ${intent.intent} (${intent.confidence})`);
      return { text: '我不太确定您的意思，请再描述一下？' };
    }
    const fn = this.registry.get(intent.intent);
    if (!fn) {
      console.warn(`Unregistered intent: ${intent.intent}`);
      return { text: '抱歉，我暂时不支持这个功能。' };
    }
    if (intent.confidence >= 0.8) {
      return this.executeImmediately(intent, userId);
    } else {
      return this.askForConfirmation(intent);
    }
  }
  /**
   * 立即执行 - 通过 TaskOrchestrator
   */
  private async executeImmediately(
    intent: UserIntent,
    userId: string
  ): Promise<AIResponse> {
    const fn = this.registry.get(intent.intent)!;
    if (fn.isLongRunning) {
      const task = this.orchestrator.executeLongRunning(
        intent.intent, intent.entities, userId
      );
      console.info(`Started long task: ${task.id} (${intent.intent})`);
      return {
        text: `好的，我正在执行${fn.description}，这可能需要几分钟...`,
        action: { type: 'start_task', taskId: task.id },
      };
    } else {
      const result = await this.orchestrator.executeImmediate(
        intent.intent, intent.entities, userId
      );
      return {
        text: `执行完成！`,
        action: result?.action,
        entities: intent.entities,
      };
    }
  }
  /**
   * 请求确认
   */
  private askForConfirmation(intent: UserIntent): AIResponse {
    const fn = this.registry.get(intent.intent)!;
    return {
      text: `您是想${fn.description}吗？`,
      action: { type: 'none' },
      entities: intent.entities,
      confidence: intent.confidence,
    };
  }
  /**
   * 确认并执行 - 通过 TaskOrchestrator
   */
  async confirmAndExecute(intent: UserIntent, userId: string): Promise<AIResponse> {
    const fn = this.registry.get(intent.intent);
    if (!fn) {
      return { text: '抱歉，该功能已不可用。' };
    }
    if (fn.isLongRunning) {
      const task = this.orchestrator.executeLongRunning(
        intent.intent, intent.entities, userId
      );
      console.info(`Confirmed & started long task: ${task.id}`);
      return {
        text: `好的，我正在执行${fn.description}，这可能需要几分钟...`,
        action: { type: 'start_task', taskId: task.id },
      };
    } else {
      const result = await this.orchestrator.executeImmediate(
        intent.intent, intent.entities, userId
      );
      return {
        text: `执行完成！`,
        action: result?.action,
        entities: intent.entities,
      };
    }
  }
  /**
   * 获取已注册的函数列表
   */
  getAvailableFunctions(): string[] {
    return this.registry.getFunctionNames();
  }
}