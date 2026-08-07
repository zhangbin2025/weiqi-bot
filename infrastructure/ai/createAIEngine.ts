/**
 * @fileoverview AI 引擎工厂
 * @description 根据运行环境自动选择 KataGo 适配器
 *
 * App 环境（userAgent 包含 WeiqiApp）→ KataGoAppAdapter（原生进程，批量分析）
 * Web 环境（浏览器）                → KataGoWebAdapter（Worker，逐手分析）
 * 
 * Fallback 机制：
 * App 环境 init() 失败时，可调用 forceUseWebAdapter() 强制使用 WebAdapter
 */

import type { IAIEngine } from './IAIEngine';
import { createKataGoWebAdapter } from './adapters/KataGoWebAdapter';
import type { NetworkManager } from '../network/core/NetworkManager';

let cachedEngine: IAIEngine | null = null;

/**
 * 判断是否在 App 环境中
 *
 * App 端 GeckoView 的 userAgent 被 override 为 "WeiqiApp/1.0"
 * 参考: MainActivity.kt setUserAgentOverride("WeiqiApp/1.0")
 */
export function isAppEnvironment(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
}

/**
 * 创建 AI 引擎
 *
 * 自动根据环境选择适配器：
 * - App 环境 → KataGoAppAdapter（原生进程 + 批量分析）
 * - Web 环境 → KataGoWebAdapter（Worker + 逐手分析）
 *
 * 全局单例：多次调用返回同一实例。
 *
 * @param networkManager - 网络管理器（可选，App 环境用于代理下载非同源模型）
 */
export function createAIEngine(networkManager?: NetworkManager): IAIEngine {
  if (cachedEngine) return cachedEngine;

  if (isAppEnvironment()) {
    const { createKataGoAppAdapter } = require('./adapters/KataGoAppAdapter');
    console.log('[AIEngineFactory] App environment detected, using KataGoAppAdapter');
    cachedEngine = createKataGoAppAdapter(networkManager);
  } else {
    console.log('[AIEngineFactory] Web environment detected, using KataGoWebAdapter');
    cachedEngine = createKataGoWebAdapter();
  }

  return cachedEngine!;
}

/**
 * 重置引擎（用于环境切换或测试）
 */
export function resetAIEngine(): void {
  cachedEngine = null;
}

/**
 * 强制使用 Web 适配器
 * 
 * @description 用于 fallback 场景：当 App 环境的原生 KataGo 不可用时，
 *              切换到 Web Worker 方案继续运行
 * @returns Web 适配器实例
 */
export function forceUseWebAdapter(): IAIEngine {
  console.log('[AIEngineFactory] Force using WebAdapter (fallback from native)');
  resetAIEngine();
  cachedEngine = createKataGoWebAdapter();
  return cachedEngine!;
}
