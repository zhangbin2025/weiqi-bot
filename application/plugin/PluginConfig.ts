/**
 * 插件系统配置（轻量，不依赖运行时/存储实现）
 * @module application/plugin/PluginConfig
 *
 * 单独成文件是为了让 /llm 命令层只 import 这两个纯函数，
 * 不把 QuickJS Worker / IndexedDB 拖进功能助手的打包链路。
 *
 * localStorage 可能不可用（Node/测试、浏览器隐私模式、Webview 限制）：
 * 此时退回到进程内内存值，读写仍然自洽，不会抛 ReferenceError。
 */

/** 自动修复轮数，默认 3；允许 1~10 */
export const DEFAULT_PLUGIN_MAX_ATTEMPTS = 3;
export const MIN_PLUGIN_MAX_ATTEMPTS = 1;
export const MAX_PLUGIN_MAX_ATTEMPTS = 10;
const STORAGE_KEY = 'weiqi.plugin.maxAttempts';

/** 无 localStorage 时的内存兜底 */
let memoryValue: number | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function normalizePluginMaxAttempts(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PLUGIN_MAX_ATTEMPTS;
  return Math.min(MAX_PLUGIN_MAX_ATTEMPTS, Math.max(MIN_PLUGIN_MAX_ATTEMPTS, Math.round(n)));
}

export function loadPluginMaxAttempts(): number {
  const s = storage();
  if (!s) return memoryValue ?? DEFAULT_PLUGIN_MAX_ATTEMPTS;
  try {
    const raw = s.getItem(STORAGE_KEY);
    return raw === null ? (memoryValue ?? DEFAULT_PLUGIN_MAX_ATTEMPTS) : normalizePluginMaxAttempts(raw);
  } catch {
    return memoryValue ?? DEFAULT_PLUGIN_MAX_ATTEMPTS;
  }
}

export function savePluginMaxAttempts(value: number): void {
  const normalized = normalizePluginMaxAttempts(value);
  memoryValue = normalized;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, String(normalized));
  } catch { /* 隐私模式下写不进去，内存值仍生效 */ }
}

/** 仅供测试：清掉进程内兜底值，避免用例间互相污染 */
export function resetPluginMaxAttemptsForTest(): void {
  memoryValue = null;
  const s = storage();
  if (s) {
    try { s.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}
