/**
 * 在线技能配方 / 清单的宽容解析与严格字段校验。
 * @module application/skill/SkillRecipe
 *
 * 边界：
 * - 只校验结构与取值，不查宿主注册表（原语是否存在由 SkillRegistry 决定）。
 * - 未知字段一律忽略（只读取已知字段、只构造已知字段）。
 * - 绝不执行配方里的任何内容：本文件只有类型判断与字符串处理。
 * - 失败时 reason 是中文可读原因，供上层静默回退内置技能。
 */

import type { SkillRecipe, SkillRegistryFile } from './SkillTypes';
import { parseSecretSpecs } from './SecretSpec';

/** 原语名即宿主注册表的固定 id：小写字母开头，只允许小写字母 / 数字 / 下划线。 */
const PRIMITIVE_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** 能力名是资源契约 exposes[].name：标识符形状，与 LlmToolContract.IDENTIFIER 同源。 */
const CAPABILITY_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

type FieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 必填非空字符串：纯空白也视为空，避免脏配方带空触发提示混进 system。 */
function readString(
  raw: Record<string, unknown>,
  key: string,
  label: string,
): FieldResult<string> {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, reason: `字段「${label}」必须是非空字符串` };
  }
  return { ok: true, value };
}

function readVersion(raw: Record<string, unknown>): FieldResult<number> {
  const value = raw['version'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: '字段「version」必须是正整数' };
  }
  return { ok: true, value };
}

function readPrimitives(raw: Record<string, unknown>): FieldResult<string[]> {
  const value = raw['primitives'];
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: '字段「primitives」必须是至少包含 1 条的字符串数组' };
  }
  const items: readonly unknown[] = value;
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item: unknown = items[i];
    if (typeof item !== 'string' || !PRIMITIVE_NAME_RE.test(item)) {
      return { ok: false, reason: `字段「primitives」第 ${i + 1} 项必须匹配 /^[a-z][a-z0-9_]*$/` };
    }
    out.push(item);
  }
  return { ok: true, value: out };
}

/**
 * 可选字段：缺省（undefined）表示不检查依赖，老配方逐字兼容。
 * 显式给值时必须是至少 1 条、每项匹配标识符形状的字符串数组；空数组视为
 * 配方写错（写了字段却什么都不要求，通常是漏填），直接拒绝，不静默当成「无依赖」。
 */
function readRequiredCapabilities(
  raw: Record<string, unknown>,
): FieldResult<string[] | undefined> {
  const value = raw['requiredCapabilities'];
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: '字段「requiredCapabilities」必须是至少包含 1 条的字符串数组' };
  }
  const items: readonly unknown[] = value;
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item: unknown = items[i];
    if (typeof item !== 'string' || !CAPABILITY_NAME_RE.test(item)) {
      return {
        ok: false,
        reason: `字段「requiredCapabilities」第 ${i + 1} 项必须匹配 /^[A-Za-z_$][A-Za-z0-9_$]*$/`,
      };
    }
    out.push(item);
  }
  return { ok: true, value: out };
}

/**
 * 可选 secrets：缺省表示不涉及凭据；显式给值时逐条过 parseSecretSpecs，
 * 结构/域名/头名不合规直接拒绝，绝不带着半份声明进运行时。
 */
/**
 * 可选 category：纯展示字段，宽松解析 —— 未知值/空串一律当缺省（走 id 兜底推导），
 * 绝不因为一个标签不认识就拒掉整条合法配方。
 */
function readCategory(raw: Record<string, unknown>): FieldResult<string | undefined> {
  const value = raw['category'];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || !value.trim()) return { ok: true, value: undefined };
  return { ok: true, value: value.trim() };
}

function readSecrets(raw: Record<string, unknown>): FieldResult<SkillRecipe['secrets']> {
  if (raw['secrets'] === undefined) return { ok: true, value: undefined };
  try {
    return { ok: true, value: parseSecretSpecs(raw['secrets']) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function parseSkillRecipe(
  raw: unknown,
): { ok: true; skill: SkillRecipe } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: '技能配方必须是一个对象' };
  }
  if (raw['schemaVersion'] !== 1) {
    return { ok: false, reason: '技能配方字段「schemaVersion」必须等于 1' };
  }

  const id = readString(raw, 'id', 'id');
  if (!id.ok) return id;
  const version = readVersion(raw);
  if (!version.ok) return version;
  const name = readString(raw, 'name', 'name');
  if (!name.ok) return name;
  const summary = readString(raw, 'summary', 'summary');
  if (!summary.ok) return summary;
  const primitives = readPrimitives(raw);
  if (!primitives.ok) return primitives;
  const requiredCapabilities = readRequiredCapabilities(raw);
  if (!requiredCapabilities.ok) return requiredCapabilities;
  const category = readCategory(raw);
  if (!category.ok) return category;
  const secrets = readSecrets(raw);
  if (!secrets.ok) return secrets;
  const prompt = readString(raw, 'prompt', 'prompt');
  if (!prompt.ok) return prompt;

  // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined。
  const skill: SkillRecipe = {
    schemaVersion: 1,
    id: id.value,
    version: version.value,
    name: name.value,
    summary: summary.value,
    primitives: primitives.value,
    ...(requiredCapabilities.value !== undefined
      ? { requiredCapabilities: requiredCapabilities.value }
      : {}),
    ...(secrets.value !== undefined ? { secrets: secrets.value } : {}),
    ...(category.value !== undefined ? { category: category.value } : {}),
    prompt: prompt.value,
  };
  return { ok: true, skill };
}

export function parseSkillRegistry(
  raw: unknown,
): { ok: true; registry: SkillRegistryFile } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: '技能清单必须是一个对象' };
  }
  if (raw['schemaVersion'] !== 1) {
    return { ok: false, reason: '技能清单字段「schemaVersion」必须等于 1' };
  }

  const name = readString(raw, 'name', 'name');
  if (!name.ok) return name;
  const description = readString(raw, 'description', 'description');
  if (!description.ok) return description;

  const value = raw['skills'];
  if (!Array.isArray(value)) {
    return { ok: false, reason: '技能清单字段「skills」必须是数组' };
  }
  const items: readonly unknown[] = value;
  const skills: SkillRecipe[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const parsed = parseSkillRecipe(items[i]);
    if (!parsed.ok) {
      return { ok: false, reason: `技能清单「skills」第 ${i + 1} 项无效：${parsed.reason}` };
    }
    skills.push(parsed.skill);
  }

  const registry: SkillRegistryFile = {
    schemaVersion: 1,
    name: name.value,
    description: description.value,
    skills,
  };
  return { ok: true, registry };
}
