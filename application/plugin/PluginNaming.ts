/**
 * 插件命名规则（纯函数）
 * @module application/plugin/PluginNaming
 *
 * 用户/LLM 明确给了名字就用那个名字；没给就按「规则1」「规则2」这样的
 * 简单名字自动排号，且不能与现有插件重名。
 */

import type { PluginContextEntry } from '@domain/plugin/types';

/** 自动命名的名字上限，避免被超长用户命名撑爆菜单/清单 */
export const MAX_PLUGIN_NAME_LENGTH = 40;

/** 归一化用户输入的名字：去首尾空白、压掉换行、限长；空串返回 undefined */
export function normalizePluginName(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, MAX_PLUGIN_NAME_LENGTH).join('');
}

/**
 * 生成不重名的简单名字：规则1、规则2……跳过已被占用的编号。
 * existingNames 通常来自 snapshot（当前全部插件），与会话无关。
 */
export function nextSimplePluginName(existingNames: string[]): string {
  const used = new Set(existingNames);
  let n = 1;
  while (used.has(`规则${n}`)) n++;
  return `规则${n}`;
}

/**
 * 决定新插件的名字：
 * - 用户/LLM 指定了名字（action.name 非空）→ 原样使用（仅做归一化）；
 * - 未指定 → 按现有插件名自动排号，保证「规则N」不撞车。
 */
export function resolvePluginName(
  requested: string | undefined,
  snapshot: PluginContextEntry[],
): string {
  return normalizePluginName(requested)
    ?? nextSimplePluginName(snapshot.map((p) => p.name));
}
