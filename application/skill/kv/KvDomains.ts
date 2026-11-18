/**
 * Skill 本地数据层 —— 域注册（新增场景的唯一改动点）
 * @module application/skill/kv/KvDomains
 *
 * 「加一类存储不推倒重来」的具体落点就在本文件：
 * 1. 写一个 KvDriver（通常只是包 infrastructure 里现成的适配器，见 KvDrivers.ts）；
 * 2. 在 createDefaultKvDomains() 里加一条 KvDomainDescriptor。
 * 内核 KvService、kv_* 工具签名、BasicPrimitives / ChatPage 装配、system 全部不动。
 * 工具集按 capabilities() 的并集动态生成：新驱动声明 'query' → kv_query 自动出现；
 * 声明 'blob' → kv_blob 自动出现（工具表在 KvPrimitives.ts 里预留）。
 *
 * 复用现状：
 * - prefs / secrets → LocalStorageAdapter（**独立命名空间 'weiqi-bot-kv'**：listKeys() 根本
 *   枚举不到 UserSkillStore / PluginConfig 等其它模块的 'weiqi-bot' 键，隔离由适配器契约保证）
 * - checkpoints     → IndexedDBAdapter（专属 dbName/storeName，容量不与 localStorage 抢）
 * - 未来 files      → IndexedDBFileAdapter（IFileStorage，已支持 Blob / readChunk / listFiles）
 * - 未来 search     → 自建索引驱动 + 'query' capability（KvDriver.query 语义由驱动解释）
 *
 * 敏感数据不局限于密钥：visibility='opaque' 是通用域策略。任何域标成 opaque，
 * 模型经任何 kv_* 都拿不到值，只回元信息；宿主代码用 KvService.readRaw() 取明文去
 * 消费（P2 直连认证拼 header 等），那条路径不经过模型、不进会话历史。
 * writableBy='host' 表示只有面板 / 宿主代码能写，模型 kv_write / kv_delete 一律拒绝。
 */

import type { KvDomainDescriptor, KvCapability } from './KvTypes';
import { LocalStorageKvDriver, IndexedDbKvDriver } from './KvDrivers';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';

/** 域名的合法形状：模型只能给这个名字，不能给物理键 / namespace / dbName */
export const KV_DOMAIN_NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * 默认域清单。这里只放「框架自带、与具体业务无关」的三类：
 * - prefs      ：使用偏好（自选股、默认分类、回复风格…），模型可读写
 * - secrets    ：敏感数据（API key / token / 任何不该进上下文的东西），宿主独占写、模型不可读
 * - checkpoints：长会话摘要 / 任务状态，大对象走 IndexedDB，模型可读写
 *
 * ⚠️ 配额数字是**显式声明的业务约束**，不是扫验证集挑出来的经验值：
 * prefs 单条上限直接取宿主具名常量 CONTEXT_LIMITS.maxCharsPerMessage（一条偏好
 * 必须能完整放进一条观察）；checkpoints / secrets 不设人为上限，交给后端容量。
 * 以后要改口径，改这里一行并写明理由即可。
 */
export function createDefaultKvDomains(): KvDomainDescriptor[] {
  const local = new LocalStorageKvDriver('weiqi-bot-kv', 'localStorage:weiqi-bot-kv');
  return [
    {
      name: 'prefs',
      summary: '用户使用偏好（如自选股、默认分类、常用参数）。模型可读写，值可回显。',
      driver: local,
      visibility: 'readable',
      writableBy: 'model',
      physicalPrefix: 'skill.kv.prefs.',
      limits: { maxValueChars: CONTEXT_LIMITS.maxCharsPerMessage },
    },
    {
      name: 'secrets',
      summary: '敏感数据（API key、token 及任何不该进入模型上下文的凭据）。仅用户面板可写，模型永远读不到值。',
      driver: local,
      visibility: 'opaque',
      writableBy: 'host',
      physicalPrefix: 'skill.kv.secrets.',
    },
    {
      name: 'checkpoints',
      summary: '长会话 compact 摘要与长期任务状态。大对象存 IndexedDB，模型可分页读写。',
      driver: new IndexedDbKvDriver('weiqi-skill-kv', 'checkpoints'),
      visibility: 'readable',
      writableBy: 'model',
      physicalPrefix: 'skill.kv.checkpoints.',
    },
  ];
}

/**
 * 域注册表：按 name 索引，重复 / 非法名直接抛错（装配期失败，不静默）。
 * 与 createSkillRegistry 的口径一致：注册表是宿主内置、固定的，在线配方不含代码。
 */
export class KvDomainRegistry {
  private readonly byName = new Map<string, KvDomainDescriptor>();

  constructor(descriptors: Iterable<KvDomainDescriptor>) {
    for (const d of descriptors) {
      if (!KV_DOMAIN_NAME_RE.test(d.name)) {
        throw new Error(`KvDomain 名不合法：${d.name}（需匹配 ${KV_DOMAIN_NAME_RE}）`);
      }
      if (this.byName.has(d.name)) {
        throw new Error(`KvDomain 重复注册：${d.name}`);
      }
      this.byName.set(d.name, d);
    }
  }

  get(name: string): KvDomainDescriptor | undefined {
    return this.byName.get(name);
  }

  list(): readonly KvDomainDescriptor[] {
    return [...this.byName.values()];
  }

  /** 所有域能力的并集：工具集按它动态生成 */
  capabilities(): ReadonlySet<KvCapability> {
    const out = new Set<KvCapability>();
    for (const d of this.byName.values()) {
      for (const c of d.driver.capabilities) out.add(c);
    }
    return out;
  }
}
