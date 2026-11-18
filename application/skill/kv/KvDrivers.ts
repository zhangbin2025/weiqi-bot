/**
 * Skill 本地数据层 —— 驱动（全部复用 infrastructure 既有适配器）
 * @module application/skill/kv/KvDrivers
 *
 * 本文件**不实现任何存储机制**，只把 infrastructure/storage 里已验收的适配器
 * 适配成 KvDriver 契约：
 * - LocalStorageKvDriver  → LocalStorageAdapter（IKeyValueStorage，命名空间隔离）
 * - IndexedDbKvDriver     → IndexedDBAdapter（文档存储，大对象 / checkpoint / 未来检索）
 * - MemoryKvDriver        → 纯内存 Map，仅供单测与无浏览器环境降级
 *
 * 未来加「大文件」：写一个包 IndexedDBFileAdapter（IFileStorage，已有 Blob / readChunk /
 * listFiles）的驱动并声明 'blob' capability；加「全文检索」：写一个包
 * IndexedDBAdapter.find({where}) 之外自建索引的驱动并声明 'query'。
 * 两种情况都**不改 KvService、不改 kv_* 工具签名、不改装配代码**。
 *
 * 为什么用「每个驱动自带 namespace / dbName」而不是让内核传物理前缀：
 * LocalStorageAdapter 的 listKeys() 只枚举自己 namespace 下的键，IndexedDBAdapter
 * 只碰自己的 dbName+storeName —— 隔离是适配器本身的契约，内核无需、也不应该
 * 直接碰 localStorage / indexedDB 全局。KvDomainDescriptor.physicalPrefix 于是只作
 * 「域内键前缀」，用于同一后端上再分域，不暴露给模型。
 */

import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { IndexedDBAdapter } from '@infrastructure/storage/adapters/web/IndexedDBAdapter';
import type {
  KvDriver, KvCapability, KvStoredValue, KvEntryMeta, KvArgs, KvOutcome,
} from './KvTypes';
import { BASE_KV_CAPABILITIES } from './KvTypes';

/** IndexedDB 里一条文档：id 就是逻辑键，其余是 KvStoredValue 展开 */
interface KvDoc extends KvStoredValue {
  id: string;
}

/**
 * localStorage 驱动：包 LocalStorageAdapter(namespace)。
 * 值以一条 KvStoredValue 整体 JSON 落盘（适配器自己序列化），读回做形状校验，
 * 坏数据按「不存在」处理 —— 与 UserSkillStore 逐条校验、坏条目跳过的口径一致。
 */
export class LocalStorageKvDriver implements KvDriver {
  readonly id: string;
  readonly capabilities: ReadonlySet<KvCapability> = BASE_KV_CAPABILITIES;
  private readonly adapter: LocalStorageAdapter;
  private init: Promise<void> | null = null;

  constructor(namespace: string, id?: string) {
    this.adapter = new LocalStorageAdapter(namespace);
    this.id = id ?? `localStorage:${namespace}`;
  }

  initialize(): Promise<void> {
    if (!this.init) {
      this.init = this.adapter.initialize().catch((e: unknown) => {
        this.init = null; // 允许重试（隐私模式下可能恢复）
        throw e;
      });
    }
    return this.init;
  }

  async get(physicalKey: string): Promise<KvStoredValue | null> {
    await this.initialize();
    const raw = await this.adapter.read<unknown>(physicalKey);
    return parseStored(raw);
  }

  async set(physicalKey: string, entry: KvStoredValue): Promise<void> {
    await this.initialize();
    await this.adapter.write(physicalKey, entry);
  }

  async remove(physicalKey: string): Promise<void> {
    await this.initialize();
    await this.adapter.delete(physicalKey);
  }

  async list(prefix: string): Promise<KvEntryMeta[]> {
    await this.initialize();
    const keys = await this.adapter.listKeys();
    const out: KvEntryMeta[] = [];
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const raw = await this.adapter.read<unknown>(key);
      const entry = parseStored(raw);
      if (!entry) continue; // 坏条目不列，避免把畸形元信息喂给模型
      out.push({ key, size: entry.size, updatedAt: entry.updatedAt });
    }
    return out;
  }
}

/**
 * IndexedDB 文档驱动：包 IndexedDBAdapter<KvDoc>。
 * set 用 findById 判定存在 → update / insert（适配器 insert 是 add，重复会抛）；
 * list 用 find() 全量取回后按 prefix 过滤并只回元信息（不把值读进内存传给模型）。
 * 建库参数由构造方给，内核不认识具体 dbName。
 */
export class IndexedDbKvDriver implements KvDriver {
  readonly id: string;
  readonly capabilities: ReadonlySet<KvCapability>;
  private readonly adapter: IndexedDBAdapter<KvDoc>;
  private init: Promise<void> | null = null;

  constructor(
    dbName: string,
    storeName: string,
    opts: { extraCapabilities?: Iterable<KvCapability>; id?: string } = {},
  ) {
    this.adapter = new IndexedDBAdapter<KvDoc>(dbName, storeName);
    this.id = opts.id ?? `indexedDB:${dbName}:${storeName}`;
    this.capabilities = mergeCapabilities(opts.extraCapabilities);
  }

  initialize(): Promise<void> {
    if (!this.init) {
      this.init = this.adapter.initialize().catch((e: unknown) => {
        this.init = null;
        throw e;
      });
    }
    return this.init;
  }

  async get(physicalKey: string): Promise<KvStoredValue | null> {
    await this.initialize();
    const doc = await this.adapter.findById(physicalKey);
    return doc === null ? null : toStored(doc);
  }

  async set(physicalKey: string, entry: KvStoredValue): Promise<void> {
    await this.initialize();
    const existing = await this.adapter.findById(physicalKey);
    const doc: KvDoc = { id: physicalKey, ...entry };
    if (existing) {
      await this.adapter.update(physicalKey, doc);
    } else {
      await this.adapter.insert(doc);
    }
  }

  async remove(physicalKey: string): Promise<void> {
    await this.initialize();
    await this.adapter.delete(physicalKey);
  }

  async list(prefix: string): Promise<KvEntryMeta[]> {
    await this.initialize();
    const docs = await this.adapter.find();
    const out: KvEntryMeta[] = [];
    for (const doc of docs) {
      if (!doc.id.startsWith(prefix)) continue;
      const entry = toStored(doc);
      if (!entry) continue;
      out.push({ key: doc.id, size: entry.size, updatedAt: entry.updatedAt });
    }
    return out;
  }
}

/**
 * 内存驱动：单测 / Node / 隐私模式降级用。行为与上面两个驱动逐字一致，
 * 因此 KvService 的测试不需要 fake-indexeddb 也能覆盖全部策略分支。
 */
export class MemoryKvDriver implements KvDriver {
  readonly id: string;
  readonly capabilities: ReadonlySet<KvCapability>;
  private readonly map = new Map<string, KvStoredValue>();

  constructor(opts: {
    id?: string;
    extraCapabilities?: Iterable<KvCapability>;
    /** 可选：非基础能力的统一入口（query / blob / …），语义由驱动自己解释 */
    invokeImpl?: (
      capability: KvCapability,
      prefix: string,
      args: KvArgs,
      entries: ReadonlyMap<string, KvStoredValue>,
    ) => Promise<KvOutcome>;
  } = {}) {
    this.id = opts.id ?? 'memory';
    this.capabilities = mergeCapabilities(opts.extraCapabilities);
    if (opts.invokeImpl) {
      const impl = opts.invokeImpl;
      this.invoke = (capability, physicalKey, args) => impl(capability, physicalKey, args, this.map);
    }
  }

  async initialize(): Promise<void> { /* 内存无需初始化 */ }

  async get(physicalKey: string): Promise<KvStoredValue | null> {
    return this.map.get(physicalKey) ?? null;
  }

  async set(physicalKey: string, entry: KvStoredValue): Promise<void> {
    this.map.set(physicalKey, entry);
  }

  async remove(physicalKey: string): Promise<void> {
    this.map.delete(physicalKey);
  }

  async list(prefix: string): Promise<KvEntryMeta[]> {
    const out: KvEntryMeta[] = [];
    for (const [key, entry] of this.map) {
      if (!key.startsWith(prefix)) continue;
      out.push({ key, size: entry.size, updatedAt: entry.updatedAt });
    }
    return out;
  }

  /** 可选：由构造参数注入；未注入时 undefined，KvService 会回「驱动未实现该能力」 */
  invoke?: (capability: KvCapability, physicalKey: string, args: KvArgs) => Promise<KvOutcome>;
}

/** 能力并集：基础能力 + 驱动额外声明，返回新 Set 避免外部改动 */
function mergeCapabilities(extra?: Iterable<KvCapability>): ReadonlySet<KvCapability> {
  const set = new Set<KvCapability>(BASE_KV_CAPABILITIES);
  if (extra) for (const c of extra) set.add(c);
  return set;
}

/** 反序列化后的形状校验：坏数据一律按「不存在」，不把畸形对象喂给策略层 */
function parseStored(raw: unknown): KvStoredValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!('value' in r) || typeof r['updatedAt'] !== 'number' || typeof r['size'] !== 'number') {
    return null;
  }
  return { value: r['value'], updatedAt: r['updatedAt'], size: r['size'] };
}

/** KvDoc → KvStoredValue（丢掉 id 这个存储细节）；顺带做同样的形状校验 */
function toStored(doc: KvDoc): KvStoredValue | null {
  return parseStored({ value: doc.value, updatedAt: doc.updatedAt, size: doc.size });
}
