/**
 * Token 用量记录器装配（浏览器页面入口各调一次）
 * @module infrastructure/token/installTokenUsageRecorder
 *
 * 「全部 LLM 请求」的覆盖保证：只要页面入口调用过本函数，本页之后所有
 * OpenAICompatibleClient 请求（对话 / 标题 / 压缩 / 技能路由 / 插件生成 /
 * 意图识别）都会经 emitTokenUsage 落到同一份本地统计。
 *
 * - 幂等：模块级布尔 + 注销函数持有者，两个入口 / HMR 重复调用不会双记；
 * - 旁路：写入异步 void + prune 失败吞掉，绝不阻塞或影响页面初始化；
 * - 未调用（CLI / 单测）时 sink 没有观察者，emit 是空操作，行为零变化。
 */

import { onTokenUsage } from '../../application/token/TokenUsageSink';
import { loadTokenRetentionDays } from '../../application/token/TokenUsageConfig';
import { tokenUsageStore } from './TokenUsageStore';

let installed = false;
let dispose: (() => void) | undefined;

export function installTokenUsageRecorder(): void {
  if (installed) return;
  installed = true;
  dispose?.();
  dispose = onTokenUsage((record) => { void tokenUsageStore.append(record); });
  // 启动即清一次过期分片（可配保留天数）；失败静默，不影响页面。
  void tokenUsageStore.prune(loadTokenRetentionDays()).catch(() => { /* 旁路 */ });
}

/** 仅供测试：解除装配，复位幂等标记 */
export function resetTokenUsageRecorderForTest(): void {
  dispose?.();
  dispose = undefined;
  installed = false;
}
