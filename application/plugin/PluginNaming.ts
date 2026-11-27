/**
 * 开发工件自动命名（纯函数，插件 / 技能共用）
 * @module application/plugin/PluginNaming
 *
 * 用户/LLM 明确给了名字就用那个名字；没给就按「<类型>N」这样的简单名字
 * 自动排号，且不能与现有同类工件重名。前缀按工件类型区分：
 * 插件 →「插件N」、技能 →「技能N」。
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
 * 生成不重名的「<前缀>N」简单名字（前缀1、前缀2……），跳过已被占用的编号。
 * 插件 / 技能共用同一套排号口径，只由前缀区分工件类型；
 * existingNames 来自当前同类工件清单，与会话无关。
 */
export function nextNumberedName(prefix: string, existingNames: readonly string[]): string {
  const used = new Set(existingNames);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** 插件自动命名：插件1、插件2…… */
export function nextSimplePluginName(existingNames: string[]): string {
  return nextNumberedName('插件', existingNames);
}

/**
 * 决定新插件的名字：
 * - 用户/LLM 指定了名字（action.name 非空）→ 原样使用（仅做归一化）；
 * - 未指定 → 按现有插件名自动排号，保证「插件N」不撞车。
 */
export function resolvePluginName(
  requested: string | undefined,
  snapshot: PluginContextEntry[],
): string {
  return normalizePluginName(requested)
    ?? nextSimplePluginName(snapshot.map((p) => p.name));
}
