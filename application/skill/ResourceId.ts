/**
 * 可发布资源 id 的命名规则（技能配方 id / 插件工件 id 共用）
 * @module application/skill/ResourceId
 *
 * 唯一出处：weiqi-assets/scripts/validate.mjs 的 ID_RE
 *   /^[a-z0-9][a-z0-9._-]*$/
 * 资源仓的 skills/registry.json 与 registry.json 条目都用这条规则校验，
 * 且 path = "<id>/skill.json" 直接由 id 拼出。本机 id 与之同形，发布时无需改名，
 * 也不会因为中文 / 冒号 / 空格被资源侧拒收。
 *
 * 这不是新发明的阈值或打分：只是把资源仓已经存在的公开契约在宿主侧复述一份，
 * 两处保持一致由注释与测试共同锁定。
 */

/** 与 weiqi-assets/scripts/validate.mjs 的 ID_RE 完全一致 */
export const RESOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** 供 UI / 工具回执复述的可读说明 */
export const RESOURCE_ID_HINT = '小写字母或数字开头，只允许小写字母 / 数字 / 点 / 连字符 / 下划线';

/** 校验并归一化（去首尾空白）；不合法返回 false */
export function isValidResourceId(raw: unknown): raw is string {
  return typeof raw === 'string' && RESOURCE_ID_RE.test(raw.trim());
}

/** 已校验前提下取归一化值；调用方须先用 isValidResourceId 判定 */
export function normalizeResourceId(raw: string): string {
  return raw.trim();
}
