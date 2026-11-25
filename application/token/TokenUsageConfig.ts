/**
 * Token 保留天数配置（轻量，不依赖任何存储实现）
 * @module application/token/TokenUsageConfig
 *
 * 与 PluginConfig 同一套路：单独成文件，让 /llm 命令层只 import 纯函数，
 * 不把 IndexedDB / pako 拖进功能助手的打包链路。
 * localStorage 不可用（Node / 测试 / 隐私模式）时退回进程内内存值，读写自洽。
 */

import {
  DEFAULT_TOKEN_RETENTION_DAYS,
  normalizeRetentionDays,
} from './TokenUsageTypes';

const STORAGE_KEY = 'weiqi.token.retentionDays';

let memoryValue: number | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadTokenRetentionDays(): number {
  const s = storage();
  if (!s) return memoryValue ?? DEFAULT_TOKEN_RETENTION_DAYS;
  try {
    const raw = s.getItem(STORAGE_KEY);
    return raw === null
      ? (memoryValue ?? DEFAULT_TOKEN_RETENTION_DAYS)
      : normalizeRetentionDays(raw);
  } catch {
    return memoryValue ?? DEFAULT_TOKEN_RETENTION_DAYS;
  }
}

export function saveTokenRetentionDays(value: number): number {
  const normalized = normalizeRetentionDays(value);
  memoryValue = normalized;
  const s = storage();
  if (!s) return normalized;
  try {
    s.setItem(STORAGE_KEY, String(normalized));
  } catch { /* 隐私模式写不进去，内存值仍生效 */ }
  return normalized;
}

/** 仅供测试：清掉进程内兜底值，避免用例间互相污染 */
export function resetTokenRetentionDaysForTest(): void {
  memoryValue = null;
  const s = storage();
  if (s) {
    try { s.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}
