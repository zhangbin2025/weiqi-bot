/**
 * 插件工件存储（纯内存实现）
 * @module infrastructure/plugin/InMemoryPluginArtifactStore
 *
 * 用途：单元测试 / Node 环境，不 import 任何浏览器 API。
 * 与 IndexedDB 版本共用本文件导出的 clone / merge / sort 纯函数，
 * 以保证两种实现行为等价 —— 存储层测试因此可以用本实现覆盖语义。
 *
 * 「会话清空后工件仍存在」：构造函数可注入一个外部 Map 作为持久化层
 * （存 JSON 文本，模拟 IndexedDB structured clone 的读写往返）。
 * 丢弃 store 实例、只保留该 Map，再新建 store 即等价于新会话。
 */

import type {
  IPluginArtifactStore,
  PluginArtifact,
  PluginRevision,
  PluginSpec,
} from '../../domain/plugin/types';

/** 作用域可选字段。单独抽出来，避免在 exactOptionalPropertyTypes 下写出 undefined 值 */
export interface PluginArtifactScope {
  eventId?: number;
}

function cloneScope(scope: PluginArtifactScope): PluginArtifactScope {
  const copy: PluginArtifactScope = {};
  if (scope.eventId !== undefined) {
    copy.eventId = scope.eventId;
  }
  return copy;
}

function cloneSpec(spec: PluginSpec): PluginSpec {
  return {
    pointId: spec.pointId,
    version: spec.version,
    entry: spec.entry,
    hostApi: [...spec.hostApi],
    limits: { ...spec.limits },
  };
}

function cloneRevision(revision: PluginRevision): PluginRevision {
  const copy: PluginRevision = {
    version: revision.version,
    code: revision.code,
    at: revision.at,
    trigger: revision.trigger,
    outcome: revision.outcome,
  };
  // exactOptionalPropertyTypes：只在真有值时写入可选属性
  if (revision.feedback !== undefined) {
    copy.feedback = revision.feedback;
  }
  return copy;
}

/** 深拷贝工件（含 spec / history / scope），等价于 IndexedDB 的 structured clone */
export function clonePluginArtifact(artifact: PluginArtifact): PluginArtifact {
  const copy: PluginArtifact = {
    id: artifact.id,
    name: artifact.name,
    pointId: artifact.pointId,
    version: artifact.version,
    enabled: artifact.enabled,
    origin: artifact.origin,
    intent: artifact.intent,
    code: artifact.code,
    spec: cloneSpec(artifact.spec),
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    history: artifact.history.map(cloneRevision),
  };
  if (artifact.scope !== undefined) {
    copy.scope = cloneScope(artifact.scope);
  }
  if (artifact.conversationRef !== undefined) {
    copy.conversationRef = artifact.conversationRef;
  }
  return copy;
}

/**
 * 把 Partial<PluginArtifact> 合并到现有工件。
 *
 * - 逐字段覆盖：patch 中为 undefined 的字段视为「未提供」，
 *   绝不会写出 `scope: undefined` 这类属性（exactOptionalPropertyTypes）。
 * - 要清空可选字段请传空对象 / 空串，而不是 undefined。
 * - id 刻意不接受 patch：IndexedDB 以 id 为 keyPath，改 id 会留下孤儿记录。
 */
export function mergePluginArtifact(
  existing: PluginArtifact,
  patch: Partial<PluginArtifact>,
): PluginArtifact {
  const merged = clonePluginArtifact(existing);
  if (patch.name !== undefined) merged.name = patch.name;
  if (patch.pointId !== undefined) merged.pointId = patch.pointId;
  if (patch.version !== undefined) merged.version = patch.version;
  if (patch.enabled !== undefined) merged.enabled = patch.enabled;
  if (patch.origin !== undefined) merged.origin = patch.origin;
  if (patch.intent !== undefined) merged.intent = patch.intent;
  if (patch.code !== undefined) merged.code = patch.code;
  if (patch.spec !== undefined) merged.spec = cloneSpec(patch.spec);
  if (patch.createdAt !== undefined) merged.createdAt = patch.createdAt;
  if (patch.updatedAt !== undefined) merged.updatedAt = patch.updatedAt;
  if (patch.history !== undefined) merged.history = patch.history.map(cloneRevision);
  if (patch.scope !== undefined) merged.scope = cloneScope(patch.scope);
  if (patch.conversationRef !== undefined) merged.conversationRef = patch.conversationRef;
  return merged;
}

/** 统一排序：updatedAt 降序，同时间戳用 id 兜底保证确定性 */
export function sortArtifactsByRecency(artifacts: PluginArtifact[]): PluginArtifact[] {
  return [...artifacts].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

/** 持久化层：id -> JSON 文本。注入同一个 Map 即可跨 store 实例共享数据 */
export type PluginArtifactPersistence = Map<string, string>;

/**
 * 读回持久化文本时做最小形状校验 + 归一化。
 * 与 ConfigStorageAdapter.import() 的「零校验无条件写所有 key」相反：
 * 这里只认工件该有的字段（由 clonePluginArtifact 逐字段重建），
 * 脏数据直接报错而不是静默变成半截工件。
 */
export function parsePluginArtifact(raw: string): PluginArtifact {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Corrupted plugin artifact: expected an object');
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate['id'] !== 'string'
    || typeof candidate['code'] !== 'string'
    || typeof candidate['intent'] !== 'string'
    || typeof candidate['version'] !== 'number'
    || !Array.isArray(candidate['history'])
    || typeof candidate['spec'] !== 'object'
    || candidate['spec'] === null
  ) {
    throw new Error(`Corrupted plugin artifact: ${String(candidate['id'])}`);
  }
  return clonePluginArtifact(parsed as PluginArtifact);
}

/**
 * 纯内存工件存储。
 *
 * 未注入 persistence 时是进程内单例式内存存储；注入后，读写都走该 Map，
 * 可用于模拟「浏览器没关、会话状态被清空」的场景。
 */
export class InMemoryPluginArtifactStore implements IPluginArtifactStore {
  private readonly persistence: PluginArtifactPersistence;

  constructor(persistence: PluginArtifactPersistence = new Map<string, string>()) {
    this.persistence = persistence;
  }

  private read(id: string): PluginArtifact | null {
    const raw = this.persistence.get(id);
    if (raw === undefined) {
      return null;
    }
    return parsePluginArtifact(raw);
  }

  private readAll(): PluginArtifact[] {
    const artifacts: PluginArtifact[] = [];
    for (const raw of this.persistence.values()) {
      artifacts.push(parsePluginArtifact(raw));
    }
    return artifacts;
  }

  private write(artifact: PluginArtifact): void {
    this.persistence.set(artifact.id, JSON.stringify(clonePluginArtifact(artifact)));
  }

  async list(): Promise<PluginArtifact[]> {
    return sortArtifactsByRecency(this.readAll());
  }

  async get(id: string): Promise<PluginArtifact | null> {
    return this.read(id);
  }

  async create(artifact: PluginArtifact): Promise<void> {
    if (this.persistence.has(artifact.id)) {
      throw new Error(`Plugin artifact "${artifact.id}" already exists`);
    }
    this.write(artifact);
  }

  async update(id: string, patch: Partial<PluginArtifact>): Promise<void> {
    const existing = this.read(id);
    if (existing === null) {
      throw new Error(`Plugin artifact "${id}" not found`);
    }
    this.write(mergePluginArtifact(existing, patch));
  }

  async remove(id: string): Promise<void> {
    this.persistence.delete(id);
  }
}
