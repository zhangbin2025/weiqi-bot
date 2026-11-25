/**
 * Token 用量旁路观察者
 * @module application/token/TokenUsageSink
 *
 * 存在的唯一理由：让 infrastructure/llm 的 HTTP 客户端能把「一次请求的用量」
 * 广播出去，而不必认识 IndexedDB、pako、面板等任何下游。
 *
 * - 全局单例注册表（模块级），页面装配期注册一次；CLI / 单测未注册时 emit 是
 *   空操作，不抛错、不改变请求行为。
 * - emit 同步遍历观察者；观察者内部自行把异步写入 void 掉。统计是旁路能力，
 *   绝不能让存储失败影响 LLM 主链路。
 */

import type { TokenUsageRecord } from './TokenUsageTypes';

export type TokenUsageObserver = (record: TokenUsageRecord) => void;

const observers = new Set<TokenUsageObserver>();

/** 注册观察者，返回注销函数（幂等：同一引用重复注册只保留一份） */
export function onTokenUsage(observer: TokenUsageObserver): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}

/** 广播一条用量；单个观察者抛错被吞掉，不影响其它观察者与请求本身 */
export function emitTokenUsage(record: TokenUsageRecord): void {
  for (const observer of observers) {
    try {
      observer(record);
    } catch {
      // 统计写入失败绝不冒泡到 LLM 请求
    }
  }
}

/** 仅供测试：清空全部观察者 */
export function resetTokenUsageObserversForTest(): void {
  observers.clear();
}
