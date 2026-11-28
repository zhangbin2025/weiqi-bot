/**
 * Skill 本地数据层 —— 编排内核
 * @module application/skill/kv/KvService
 *
 * 这是唯一改不得、也不需要改的一层。它只做四件事：
 * 1. 校验调用参数（domain 必须注册、key 形状、值可序列化）；
 * 2. 把 (domain, key) 映射成物理键（physicalPrefix 由域描述符写死，模型触达不到其它键）；
 * 3. 按域策略裁决：visibility='opaque' → 任何模型可见操作都不回值；
 *    writableBy='host' → 拒绝模型写 / 删；limits → 按显式声明的业务约束拦截；
 * 4. 调驱动的基础方法，或把非基础能力统一委派给 driver.invoke()。
 *
 * 扩展不改内核的证明：新增 capability 时这里没有 per-capability 分支 —— 基础能力走
 * 5 个固定 case，其余一律 `default: → driver.invoke()`。新增域也只是往注册表加一条。
 *
 * 宿主面板 / P2 直连消费走 readRaw() / put() / remove()：它们绕过「模型可见性」策略，
 * 但仍经过同一套物理键映射与驱动（不碰全局 localStorage），且只供宿主代码调用，
 * 绝不挂进任何模型可见的工具集。
 */

import type {
  KvCapability, KvDomainDescriptor, KvArgs, KvOutcome, KvStoredValue, KvServiceLike,
} from './KvTypes';
import { BASE_KV_CAPABILITIES } from './KvTypes';
import type { KvDomainRegistry } from './KvDomains';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';

/** key 形状：模型给的键只允许标识符式字符串，杜绝 '../'、':'、超长键等路径玩法 */
export const KV_KEY_RE = /^[A-Za-z0-9_.\-]{1,128}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(reason: string, detail = reason): KvOutcome {
  return { observation: `kv：${reason}`, ok: false, detail };
}

/** 只读准备动作统一标 preparatory=true，不消耗 ToolLoop 的自主决策预算 */
function readonly(observation: string, detail: string): KvOutcome {
  return { observation, ok: true, detail, preparatory: true };
}

/** 把任意业务值序列化成字符串，顺带得到字符数（写入时算一次，list/slice 复用） */
function serializeValue(value: unknown): { text: string; size: number } | null {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') return null; // undefined / function / symbol / BigInt
    return { text, size: text.length };
  } catch {
    return null; // 循环引用等
  }
}

/** 观察文本预算：直接沿用宿主具名常量，与 ToolLoop.clipObservation 同源，不另造阈值 */
const OBS_BUDGET = CONTEXT_LIMITS.maxCharsPerMessage;

/** 简单值读回显也按观察上限收口，尾部提示「用 kv_slice 读全」，不静默截断 */
function clipForObservation(text: string): string {
  if (text.length <= OBS_BUDGET) return text;
  const tail = `\n[值超过单条观察上限，已截断；请用 kv_slice 分页读全，不要凭这段补全]`;
  return text.slice(0, Math.max(0, OBS_BUDGET - tail.length)) + tail;
}

export class KvService implements KvServiceLike {
  constructor(private readonly registry: KvDomainRegistry) {}

  domains(): readonly KvDomainDescriptor[] {
    return this.registry.list();
  }

  capabilities(): ReadonlySet<KvCapability> {
    return this.registry.capabilities();
  }

  /**
   * 模型可见操作的统一分派入口。工具层只调它，不认识具体方法。
   * 新增能力 → KvPrimitives 加一个工具因子即可，本方法无需修改。
   */
  async execute(capability: KvCapability, args: KvArgs): Promise<KvOutcome> {
    const domain = this.resolveDomain(args);
    if ('error' in domain) return domain.error;
    const d = domain.descriptor;

    // 基础能力由内核统一处理；非基础能力全部委派给驱动（内核零分支）
    if (!BASE_KV_CAPABILITIES.has(capability)) {
      return this.invokeExtra(d, capability, args);
    }
    switch (capability) {
      case 'read':   return this.doRead(d, args);
      case 'write':  return this.doWrite(d, args);
      case 'remove': return this.doRemove(d, args);
      case 'list':   return this.doList(d, args);
      case 'slice':  return this.doSlice(d, args);
      default:       return fail(`未支持的能力 ${capability}`);
    }
  }

  // ---------- 域解析与策略 ----------

  private resolveDomain(
    args: KvArgs,
  ): { descriptor: KvDomainDescriptor } | { error: KvOutcome } {
    const name = args['domain'];
    if (typeof name !== 'string' || name.length === 0) {
      const names = this.registry.list().map((d) => d.name).join('、');
      return { error: fail(`缺少 domain，可用域：${names || '（无）'}`, '缺少 domain') };
    }
    const d = this.registry.get(name);
    if (!d) {
      const names = this.registry.list().map((x) => x.name).join('、');
      return { error: fail(`未知域 ${name}，可用域：${names || '（无）'}`, `未知域 ${name}`) };
    }
    return { descriptor: d };
  }

  private readKey(args: KvArgs): string | null {
    const key = args['key'];
    return typeof key === 'string' && KV_KEY_RE.test(key) ? key : null;
  }

  private physical(d: KvDomainDescriptor, key: string): string {
    return `${d.physicalPrefix}${key}`;
  }

  /** 模型可见的读一律经过可见性策略；宿主消费走 readRaw() */
  private visibleValue(d: KvDomainDescriptor, entry: KvStoredValue): string {
    if (d.visibility === 'opaque') return '（敏感域：值不回显，仅确认存在与元信息）';
    return JSON.stringify(entry.value);
  }

  private modelWritable(d: KvDomainDescriptor): boolean {
    return d.writableBy === 'model' || d.writableBy === 'both';
  }

  /** 写入前的显式业务约束检查（数值来自域描述符声明，不来自扫网格） */
  private checkLimits(d: KvDomainDescriptor, size: number, key: string): KvOutcome | null {
    const lim = d.limits;
    if (lim?.maxValueChars !== undefined && size > lim.maxValueChars) {
      return fail(
        `域 ${d.name} 单条上限 ${lim.maxValueChars} 字符，本次 ${size} 字符，未写入。`
        + '（上限是该域显式声明的业务约束）',
        '超出单条上限',
      );
    }
    void key;
    return null;
  }

  // ---------- 基础能力 ----------

  private async doRead(d: KvDomainDescriptor, args: KvArgs): Promise<KvOutcome> {
    const key = this.readKey(args);
    if (!key) return fail('key 不合法（只允许 1~128 位字母数字 _ . -）', 'key 不合法');
    try {
      const entry = await d.driver.get(this.physical(d, key));
      if (!entry) return readonly(`kv_read：域 ${d.name} 中不存在键 ${key}。`, `读取 ${d.name}/${key}（未命中）`);
      const body = this.visibleValue(d, entry);
      const head = `kv_read：域 ${d.name} / ${key}（${entry.size} 字符，更新于 ${new Date(entry.updatedAt).toISOString()}）\n`;
      return readonly(
        clipForObservation(head + body),
        `读取 ${d.name}/${key}`,
      );
    } catch (e) {
      return fail(`读取 ${d.name}/${key} 失败：${errText(e)}`, '驱动读取失败');
    }
  }

  private async doWrite(d: KvDomainDescriptor, args: KvArgs): Promise<KvOutcome> {
    if (!this.modelWritable(d)) {
      return fail(
        `域 ${d.name} 只允许用户在设置面板录入与修改，模型不能写入。`
        + '请把内容交给用户，由他在面板保存；不要尝试其它域绕过。',
        `模型不可写 ${d.name}`,
      );
    }
    const key = this.readKey(args);
    if (!key) return fail('key 不合法（只允许 1~128 位字母数字 _ . -）', 'key 不合法');
    if (!('value' in args)) return fail('缺少 value', '缺少 value');
    const ser = serializeValue(args['value']);
    if (!ser) return fail('value 不是可 JSON 序列化的值', 'value 不可序列化');
    const limited = this.checkLimits(d, ser.size, key);
    if (limited) return limited;
    if (d.limits?.maxEntries !== undefined) {
      const metas = await d.driver.list(d.physicalPrefix);
      if (metas.length >= d.limits.maxEntries && !metas.some((m) => m.key === this.physical(d, key))) {
        return fail(
          `域 ${d.name} 条目上限 ${d.limits.maxEntries}，已达上限且不是覆盖已有键，未写入。`,
          '超出条目上限',
        );
      }
    }
    const entry: KvStoredValue = {
      value: JSON.parse(ser.text) as unknown, // 写入规范化后的值，去掉 undefined 等脏字段
      updatedAt: Date.now(),
      size: ser.size,
    };
    try {
      await d.driver.set(this.physical(d, key), entry);
      // opaque 域模型本来就不能写，这里仍不回显值，口径统一
      return {
        observation: `kv_write：已保存域 ${d.name} / ${key}（${ser.size} 字符）。`,
        ok: true, detail: `保存 ${d.name}/${key}`,
      };
    } catch (e) {
      return fail(`写入 ${d.name}/${key} 失败：${errText(e)}`, '驱动写入失败');
    }
  }

  private async doRemove(d: KvDomainDescriptor, args: KvArgs): Promise<KvOutcome> {
    if (!this.modelWritable(d)) {
      return fail(`域 ${d.name} 只允许用户在设置面板删除，模型不能删除。`, `模型不可删 ${d.name}`);
    }
    const key = this.readKey(args);
    if (!key) return fail('key 不合法', 'key 不合法');
    try {
      await d.driver.remove(this.physical(d, key));
      return { observation: `kv_delete：已删除域 ${d.name} / ${key}。`, ok: true, detail: `删除 ${d.name}/${key}` };
    } catch (e) {
      return fail(`删除 ${d.name}/${key} 失败：${errText(e)}`, '驱动删除失败');
    }
  }

  private async doList(d: KvDomainDescriptor, args: KvArgs): Promise<KvOutcome> {
    const prefix = args['prefix'];
    if (prefix !== undefined && (typeof prefix !== 'string' || !KV_KEY_RE.test(prefix))) {
      return fail('prefix 不合法', 'prefix 不合法');
    }
    try {
      const metas = await d.driver.list(d.physicalPrefix + (typeof prefix === 'string' ? prefix : ''));
      const lines = metas.map((m) =>
        `${m.key.slice(d.physicalPrefix.length)}\t${m.size} 字符\t${new Date(m.updatedAt).toISOString()}`);
      const head = `kv_list：域 ${d.name}，${lines.length} 条（仅键名与元信息，不含值`
        + (d.visibility === 'opaque' ? '；敏感域永不回显值' : '') + '）';
      return readonly(lines.length ? `${head}\n${lines.join('\n')}` : `${head}\n（空）`, `列出 ${d.name}`);
    } catch (e) {
      return fail(`列出 ${d.name} 失败：${errText(e)}`, '驱动列举失败');
    }
  }

  /**
   * 大值分页读：把值序列化成字符串按字符区间切。
   * 预算与 web_cache_read 同源（CONTEXT_LIMITS.maxCharsPerMessage），
   * 观察严格不超过它，尾部明确提示是否到末尾 —— 不凭预览编造。
   */
  private async doSlice(d: KvDomainDescriptor, args: KvArgs): Promise<KvOutcome> {
    const key = this.readKey(args);
    if (!key) return fail('key 不合法', 'key 不合法');
    const offset = args['offset'];
    const length = args['length'];
    const start = typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
    if (typeof offset !== 'number' && offset !== undefined) return fail('offset 必须是数字', 'offset 不合法');
    if (typeof length !== 'number' && length !== undefined) return fail('length 必须是数字', 'length 不合法');
    try {
      const entry = await d.driver.get(this.physical(d, key));
      if (!entry) return readonly(`kv_slice：域 ${d.name} 中不存在键 ${key}。`, `分页读 ${d.name}/${key}（未命中）`);
      if (d.visibility === 'opaque') {
        return readonly(
          `kv_slice：域 ${d.name} / ${key} 是敏感域，值不回显。仅告知：${entry.size} 字符，`
          + `更新于 ${new Date(entry.updatedAt).toISOString()}。`,
          `敏感域分页读被拒 ${d.name}/${key}`,
        );
      }
      const text = JSON.stringify(entry.value) ?? '';
      const head = `kv_slice：域 ${d.name} / ${key}，共 ${text.length} 字符。\n`;
      const foot = (n: number): string =>
        `\n\n[已读 ${start + n} / ${text.length} 字符`
        + (start + n < text.length ? '；未到末尾，用 offset 继续翻页]' : '；已到末尾]');
      let take = Math.max(0, OBS_BUDGET - head.length - foot(0).length);
      if (typeof length === 'number' && Number.isFinite(length)) {
        take = Math.min(take, Math.max(0, Math.trunc(length)));
      }
      const body = text.slice(start, start + take);
      const observation = (head + body + foot(body.length)).slice(0, OBS_BUDGET);
      return readonly(observation, `分页读 ${d.name}/${key} [${start},${start + body.length})`);
    } catch (e) {
      return fail(`分页读 ${d.name}/${key} 失败：${errText(e)}`, '驱动分页读失败');
    }
  }

  /** 非基础能力：统一委派，内核不认识 query / blob 的语义 */
  private async invokeExtra(
    d: KvDomainDescriptor, capability: KvCapability, args: KvArgs,
  ): Promise<KvOutcome> {
    if (!d.driver.capabilities.has(capability)) {
      return fail(`域 ${d.name} 的驱动未声明能力 ${capability}`, `能力 ${capability} 不可用`);
    }
    if (!d.driver.invoke) {
      return fail(`域 ${d.name} 的驱动声明了 ${capability} 但未实现 invoke()`, '驱动未实现该能力');
    }
    const key = this.readKey(args);
    const physicalKey = key === null ? d.physicalPrefix : this.physical(d, key);
    try {
      const result = await d.driver.invoke(capability, physicalKey, args);
      // opaque 域的扩展能力同样不许把值带回来：只保留回执，不回显任何内容片段
      if (d.visibility === 'opaque') {
        return {
          observation: `kv：域 ${d.name} 的 ${capability} 已执行（敏感域不回显结果内容）。`,
          ok: result.ok,
          detail: result.detail,
          ...(result.preparatory ? { preparatory: true } : {}),
        };
      }
      // 扩展能力的回执同样按观察上限收口：新驱动（检索 / 大文件）自动继承同一边界，
      // 不需要每个驱动自己记得 clip。
      return { ...result, observation: clipForObservation(result.observation) };
    } catch (e) {
      return fail(`域 ${d.name} 的 ${capability} 执行失败：${errText(e)}`, '扩展能力执行失败');
    }
  }

  // ---------- 宿主专用接口（不挂工具集，不经过模型） ----------

  /**
   * 取明文（含 opaque 域）。仅供设置面板展示 / P2 直连认证消费。
   * 调用方必须自行保证不把结果写进任何模型消息 / 会话历史。
   */
  async readRaw(domain: string, key: string): Promise<unknown | null> {
    const d = this.registry.get(domain);
    if (!d || !KV_KEY_RE.test(key)) return null;
    const entry = await d.driver.get(this.physical(d, key));
    return entry === null ? null : entry.value;
  }

  /** 面板写入（可写 host 域）；返回结构化结果，不给模型用 */
  async put(domain: string, key: string, value: unknown): Promise<{ ok: boolean; reason?: string }> {
    const d = this.registry.get(domain);
    if (!d) return { ok: false, reason: `未知域 ${domain}` };
    if (!KV_KEY_RE.test(key)) return { ok: false, reason: 'key 不合法' };
    const ser = serializeValue(value);
    if (!ser) return { ok: false, reason: 'value 不可序列化' };
    const limited = this.checkLimits(d, ser.size, key);
    if (limited) return { ok: false, reason: limited.detail };
    await d.driver.set(this.physical(d, key), {
      value: JSON.parse(ser.text) as unknown, updatedAt: Date.now(), size: ser.size,
    });
    return { ok: true };
  }

  /** 面板删除（可删 host 域） */
  async remove(domain: string, key: string): Promise<void> {
    const d = this.registry.get(domain);
    if (d && KV_KEY_RE.test(key)) await d.driver.remove(this.physical(d, key));
  }

  /** 面板列元信息（含 opaque 域，仍不回值） */
  async listMeta(domain: string): Promise<Array<{ key: string; size: number; updatedAt: number }>> {
    const d = this.registry.get(domain);
    if (!d) return [];
    const metas = await d.driver.list(d.physicalPrefix);
    return metas.map((m) => ({ key: m.key.slice(d.physicalPrefix.length), size: m.size, updatedAt: m.updatedAt }));
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
