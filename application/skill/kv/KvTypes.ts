/**
 * Skill 本地数据层 —— 核心契约（类型唯一来源）
 * @module application/skill/kv/KvTypes
 *
 * 设计目标：先把「扩展点」焊死。后面加一类存储（大文件 / 全文检索 / 向量索引 /
 * 任意新的业务域），只做两件事：① 写一个实现 KvDriver 的驱动（可选声明额外能力）；
 * ② 注册一条 KvDomainDescriptor。内核 KvService、模型可见的 kv_* 原语签名、
 * 装配代码、system 都不用改 —— 这就是「加场景不推倒重来」的落点。
 *
 * 三层分离：
 * - KvDriver  = 纯存储机制（localStorage / IndexedDB / 未来 Blob / Index），
 *               只认「物理 key ↔ 一条 KvStoredValue」，不懂 domain、不懂模型、不懂策略。
 * - KvDomain  = 逻辑域描述符：把 domain 名绑到一个驱动 + 一组可见性/写入/配额策略。
 *               模型只能给 domain 这个枚举名，物理键由内核按 physicalPrefix 写死，
 *               因此模型没有任何「借 kv_* 触达其它 localStorage / IndexedDB 键」的路径。
 * - KvService = 编排：解析调用 → 查域 → 按策略决定回显 / 拒绝 → 调驱动 → 组装回执。
 *
 * 能力协商（capability）：内核对所有域默认提供 BASE_KV_CAPABILITIES；驱动只需声明
 * 「额外的」能力（query / blob…）。kv_* 工具集按所有已注册域能力的并集动态生成：
 * 新驱动声明 query → kv_query 自动出现；工具定义、注册表、装配都不变。
 *
 * 敏感数据策略（对应用户「不止密钥」的要求）：visibility='opaque' 是一个通用策略，
 * 不限于 apiKey。任何域标成 opaque，模型经 kv_read/kv_list/kv_slice/kv_query 永远
 * 拿不到值，只回元信息；宿主代码仍可用 KvService.readRaw() 取明文去消费（P2 直连
 * 认证拼 header），那条路径不经过模型、不进会话历史。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';

/** 驱动能力。工具集按所有域的能力并集生成，新增能力在此加一项 + 在 KvPrimitives 加表项。 */
export type KvCapability =
  | 'read'      // 按键取值
  | 'write'     // 按键写入
  | 'remove'    // 按键删除
  | 'list'      // 列键 + 元信息（不含值）
  | 'slice'     // 大值分页读（内核通用：把值序列化后按字符区间切）
  | 'query'     // 检索（未来：全文 / 标签 / 向量），查询语义由驱动解释
  | 'blob';     // 大文件（未来：Blob / File 句柄），预留扩展点

/**
 * 内核对所有域默认提供的能力（只依赖 KvDriver 的基础方法）。
 * 驱动的 capabilities 只填「额外的」能力，不必重复这里。
 */
export const BASE_KV_CAPABILITIES: ReadonlySet<KvCapability> =
  new Set<KvCapability>(['read', 'write', 'remove', 'list', 'slice']);

/** 能力 → 模型可见原语名：单一出处，避免工具层与生成器各写一份 */
export const KV_TOOL_NAMES: Readonly<Record<KvCapability, string>> = {
  read: 'kv_read',
  write: 'kv_write',
  remove: 'kv_delete',
  list: 'kv_list',
  slice: 'kv_slice',
  query: 'kv_query',
  blob: 'kv_blob',
};

/**
 * 可见性：决定 kv_* 能不能把「值」回给模型。
 * - 'readable'：值可回显（偏好 / 检查点本来就是给模型看的；checkpoint 可读但 host-only 写）
 * - 'opaque'  ：值永不经模型上下文，只回元信息。不限于密钥，任何敏感数据域都可用。
 */
export type KvVisibility = 'readable' | 'opaque';

/**
 * 谁能写这个域（只约束「模型发起的 kv_write / kv_delete」）：
 * - 'model'：模型可写（偏好）
 * - 'host' ：只有宿主代码（设置面板 / compact 引擎等）可写，模型一律拒绝
 *            （敏感数据、宿主内部生成的 checkpoint）
 * - 'both' ：两者都可写
 * 宿主内部编程接口 KvService.put() 不受此限制（面板录入敏感数据走它）。
 */
export type KvWritableBy = 'model' | 'host' | 'both';

/** 存到驱动里的一条：业务值 + 宿主管理的元信息。业务值一律是可 JSON 序列化的 unknown。 */
export interface KvStoredValue {
  value: unknown;
  /** Date.now() 毫秒；仅展示用，不参与任何判定 */
  updatedAt: number;
  /** 序列化后的字符数；写入前由内核算好，list / slice 直接用，不重复序列化 */
  size: number;
}

/** 驱动列键时回的元信息（不含值，供 opaque 域安全展示） */
export interface KvEntryMeta {
  key: string;
  size: number;
  updatedAt: number;
}

/** 通用检索条件：语义由驱动解释，内核只透传、不理解 */
export interface KvQuery {
  pattern?: string;
  tags?: string[];
  skip?: number;
  limit?: number;
}

/** 一条检索命中（不含值；snippet 回给模型前同样受 visibility 约束） */
export interface KvHit {
  key: string;
  score?: number;
  snippet?: string;
}

/**
 * 驱动：纯存储机制。所有基础方法只认「域前缀后的物理 key」。
 * 内核把 (domain, key) 映射成物理键，驱动看不到 domain 之外的东西。
 *
 * 扩展点 invoke()：基础能力（read/write/remove/list/slice）由 KvService 用统一语义
 * 处理；**任何非基础能力**（query / blob / 未来新增的 capability）一律委派给驱动的
 * invoke()，由驱动自己解释参数、自己组装回执。于是「加一种检索 / 大文件能力」
 * 只需：在 KvCapability 加名字 + KV_TOOL_NAMES 加工具名 + KvFactors 加一条定义 +
 * 驱动声明该能力并实现 invoke()。KvService 没有任何 per-capability 分支，不改一行。
 *
 * 驱动声明了非基础能力却没实现 invoke → KvService 回「驱动未实现该能力」，不静默成功。
 */
export interface KvDriver {
  readonly id: string;
  /** 额外能力（基础能力由 BASE_KV_CAPABILITIES 并入，不必重复声明） */
  readonly capabilities: ReadonlySet<KvCapability>;
  initialize(): Promise<void>;
  get(physicalKey: string): Promise<KvStoredValue | null>;
  set(physicalKey: string, entry: KvStoredValue): Promise<void>;
  remove(physicalKey: string): Promise<void>;
  /** 列出 prefix 下的键 + 元信息（不含值） */
  list(prefix: string): Promise<KvEntryMeta[]>;
  /** 可选：非基础能力的统一入口（query / blob / …）。语义与输出由驱动负责。 */
  invoke?(capability: KvCapability, physicalKey: string, args: KvArgs): Promise<KvOutcome>;
}

/**
 * 域描述符：把逻辑 domain 名绑到驱动 + 策略。新增一类存储 = 加一条这个。
 * 配额是显式声明的业务约束（可争议、可改），内核不内置任何 magic number；
 * 未声明 limits = 不额外限制，交给后端自身容量（localStorage ~5MB / IndexedDB 配额）。
 */
export interface KvDomainDescriptor {
  /** 模型可见的域名（枚举值），只允许 [a-z][a-z0-9_]*，注册表校验 */
  name: string;
  /** 一句话说明，进工具 description / 面板，给模型和人看这个域放什么 */
  summary: string;
  driver: KvDriver;
  visibility: KvVisibility;
  writableBy: KvWritableBy;
  /**
   * 物理键前缀：内核把 (domain,key) 落到 ${physicalPrefix}${key}。
   * 模型完全接触不到，因此无法借 kv_* 触达其它存储键。
   */
  physicalPrefix: string;
  limits?: {
    maxValueChars?: number;
    maxEntries?: number;
  };
}

/** 内核操作统一回执：回填给模型的观察文本 + 过程块摘要（形状与 PrimitiveResult 兼容） */
export interface KvOutcome {
  observation: string;
  ok: boolean;
  detail: string;
  /** 只读准备动作（list / read / slice / query 置位），不消耗自主决策预算 */
  preparatory?: boolean;
}

/** service 方法统一入参：脏值在 service 层拦截，工具层只做 JSON.parse */
export type KvArgs = Record<string, unknown>;

/**
 * 一个能力对应的工具定义素材。用「按域清单动态生成 definition」的函数而不是常量，
 * 因为模型必须在注册工具时就看到当前有哪些 domain 可选、各自放什么 —— 这个清单会随
 * 新域注册变化，不能写死在字符串里。
 */
export interface KvToolFactor {
  definition(domainsText: string): ModelToolDefinition;
}

/**
 * 工具层依赖的最小 service 面：**单一分派入口 execute()**。
 * 这是「扩能力不改签名」的关键：新增一种能力时，只需在 KvPrimitives 的工具表加一项
 * + 在 KvService.execute() 的 switch 加一个 case；工具集生成、装配、类型全部不变。
 * 宿主面板用的具名方法（readRaw / put / …）属于 KvService 具体类，不在本接口里。
 */
export interface KvServiceLike {
  execute(capability: KvCapability, args: KvArgs): Promise<KvOutcome>;
  domains(): readonly KvDomainDescriptor[];
  capabilities(): ReadonlySet<KvCapability>;
}
