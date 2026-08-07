// FunctionRegistry.ts - 函数注册表
import type { AIFunction, ExecutionContext, FunctionDefinition } from './types';
import type { ILogger } from '../../infrastructure/logger/types';
/**
 * 函数注册表
 * 管理所有可被 AI 调用的函数
 */
export class FunctionRegistry {
  private functions: Map<string, AIFunction> = new Map();
  constructor(logger: ILogger) {
    this.logger = logger;
  }
  /**
   * 注册单个函数
   */
  register(fn: AIFunction): void {
    if (this.functions.has(fn.name)) {
      this.logger.warn(`Function "${fn.name}" already registered, overwriting`);
    }
    this.functions.set(fn.name, fn);
  }
  /**
   * 批量注册函数
   */
  registerAll(functions: AIFunction[]): void {
    for (const fn of functions) {
      this.register(fn);
    }
  }
  /**
   * 获取函数定义
   */
  get(name: string): AIFunction | undefined {
    return this.functions.get(name);
  }
  /**
   * 检查函数是否存在
   */
  has(name: string): boolean {
    return this.functions.has(name);
  }
  /**
   * 执行函数
   */
  async execute(name: string, params: any, context?: ExecutionContext): Promise<any> {
    const fn = this.functions.get(name);
    if (!fn) {
      throw new Error(`Function not found: ${name}`);
    }
    return fn.execute(params, context);
  }
  /**
   * 获取所有函数定义（供 LLM 使用）
   */
  getDefinitions(): FunctionDefinition[] {
    return Array.from(this.functions.values()).map(fn => ({
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
    }));
  }
  /**
   * 检查是否为长时任务
   */
  isLongRunning(name: string): boolean {
    return this.functions.get(name)?.isLongRunning ?? false;
  }
  /**
   * 获取所有已注册的函数名
   */
  getFunctionNames(): string[] {
    return Array.from(this.functions.keys());
  }
  /**
   * 取消注册函数
   */
  unregister(name: string): boolean {
    return this.functions.delete(name);
  }
  /**
   * 清空所有注册的函数
   */
  clear(): void {
    this.functions.clear();
  }
}