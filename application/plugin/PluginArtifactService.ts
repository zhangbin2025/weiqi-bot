/**
 * 插件工件生命周期（纯逻辑，不依赖浏览器 API / 会话状态）
 * @module application/plugin/PluginArtifactService
 *
 * 工件是唯一真相：intent / spec / history 全量自足地落在 store 里，
 * 聊天会话丢失后仍能 get / revise / setEnabled。
 */

import type {
  ExtensionPointId,
  IPluginArtifactStore,
  PluginArtifact,
  PluginCatalogRef,
  PluginRevision,
  PluginSpec,
} from '../../domain/plugin/types';

export interface CreatePluginArtifactInput {
  /** 可选：新建时指定发布用 id（与 weiqi-assets 命名规则同形）；不给则生成 */
  id?: string;
  name: string;
  intent: string;
  code: string;
  pointId: ExtensionPointId;
  origin: PluginArtifact['origin'];
  spec: PluginSpec;
  scope?: { eventId?: number };
  conversationRef?: string;
  /** 在线插件安装时写入来源标记，供后续比对更新；LLM/手工新建时为 undefined */
  catalogRef?: PluginCatalogRef;
  /** LLM/手工新建 workflow-operator 时的稳定算子短名（见 PluginArtifact.slug） */
  slug?: string;
  /** workflow-operator 安装时写入算子契约（exposes[]/smoke[]），随工件持久化 */
  operatorContract?: PluginArtifact['operatorContract'];
  /** 在线插件清单声明的分类标签，随工件持久化，供本地面板筛选 */
  category?: string;
}

export interface RevisePluginArtifactInput {
  /** 永远是全量源码，不是 diff */
  code: string;
  trigger: PluginRevision['trigger'];
  feedback?: string;
  /** 省略表示这版代码被采纳为当前生效版本 */
  outcome?: PluginRevision['outcome'];
  /** 可选：补正/更新稳定算子短名（首建时漏给可在这里补，不改则沿用现工件） */
  slug?: string;
}

/** 可注入时钟，便于测试精确断言时间戳 */
export type PluginClock = () => number;

let idSequence = 0;

function generateArtifactId(now: number): string {
  idSequence = (idSequence + 1) % 0xffffff;
  const random = `${idSequence.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `plugin:${now}:${random}`;
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

export class PluginArtifactService {
  constructor(
    private readonly store: IPluginArtifactStore,
    private readonly clock: PluginClock = () => Date.now(),
  ) {}

  /**
   * 新建工件。人工闸门：enabled 恒为 false，必须由人显式 setEnabled(true)。
   */
  async create(input: CreatePluginArtifactInput): Promise<PluginArtifact> {
    const at = this.clock();
    const createRevision: PluginRevision = {
      version: 1,
      code: input.code,
      at,
      trigger: 'create',
      outcome: 'accepted',
    };
    const artifact: PluginArtifact = {
      id: input.id ?? generateArtifactId(at),
      name: input.name,
      pointId: input.pointId,
      version: 1,
      enabled: false,
      origin: input.origin,
      intent: input.intent,
      code: input.code,
      spec: cloneSpec(input.spec),
      createdAt: at,
      updatedAt: at,
      history: [createRevision],
    };
    if (input.scope !== undefined) {
      const scope: { eventId?: number } = {};
      if (input.scope.eventId !== undefined) {
        scope.eventId = input.scope.eventId;
      }
      artifact.scope = scope;
    }
    if (input.conversationRef !== undefined) {
      artifact.conversationRef = input.conversationRef;
    }
    if (input.catalogRef !== undefined) {
      artifact.catalogRef = {
        registryUrl: input.catalogRef.registryUrl,
        resourceId: input.catalogRef.resourceId,
      };
    }
    if (input.slug !== undefined) artifact.slug = input.slug;
    if (input.operatorContract !== undefined) {
      artifact.operatorContract = JSON.parse(JSON.stringify(input.operatorContract)) as NonNullable<PluginArtifact['operatorContract']>;
    }
    if (input.category !== undefined) artifact.category = input.category;
    await this.store.create(artifact);
    return artifact;
  }

  /**
   * 修订：全量替换 code，version + 1，history 追加一条新版本快照。
   * 旧 code 仍留在之前的 history 记录里（history 是版本快照链，不是 diff）。
   * 其余字段一律原样保留，保证工件自足。
   */
  async revise(id: string, input: RevisePluginArtifactInput): Promise<PluginArtifact> {
    const existing = await this.requireArtifact(id);
    const at = this.clock();
    const version = existing.version + 1;
    const revision: PluginRevision = {
      version,
      code: input.code,
      at,
      trigger: input.trigger,
      outcome: input.outcome ?? 'accepted',
    };
    if (input.feedback !== undefined) {
      revision.feedback = input.feedback;
    }
    const history: PluginRevision[] = [...existing.history, revision];
    const updated: PluginArtifact = {
      ...existing,
      code: input.code,
      version,
      updatedAt: at,
      history,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
    };
    // 只提交变化字段，依赖 store 的 merge 语义保留 intent/spec/scope 等。
    await this.store.update(id, {
      code: updated.code,
      version: updated.version,
      updatedAt: updated.updatedAt,
      history: updated.history,
      ...(input.slug !== undefined ? { slug: updated.slug } : {}),
    });
    return updated;
  }

  /**
   * 在线源安装/更新时同步分类标签（纯展示字段）。传 undefined 表示清单撤掉标注，
   * 清掉旧值让 UI 按 pointId 兜底推导。与 operatorContract 契约同步同一套路。
   */
  async syncCategory(id: string, category: string | undefined): Promise<void> {
    await this.requireArtifact(id);
    // exactOptionalPropertyTypes 下用 `in` 语义的 patch 才能表达「显式清空」
    await this.store.update(id, { category } as unknown as Partial<PluginArtifact>);
  }

  /** 人工闸门：显式启用 / 停用；顺带刷新 updatedAt 让清单排序反映这次变更 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.requireArtifact(id);
    await this.store.update(id, { enabled, updatedAt: this.clock() });
  }

  /**
   * 在线源更新 workflow-operator 工件时同步算子契约（exposes[]/smoke[]）。
   * 与 revise 分开是因为 revise 是「模型/用户改源码」的通用语义，不该隐式改契约；
   * 这里只由 catalog 安装链路调用。传 undefined 表示清掉旧契约（远端不再声明）。
   */
  async syncOperatorContract(
    id: string,
    contract: NonNullable<PluginArtifact['operatorContract']> | undefined,
  ): Promise<void> {
    await this.requireArtifact(id);
    // IPluginArtifactStore.update 的 patch 是 Partial<PluginArtifact>：在
    // exactOptionalPropertyTypes 下无法表达「显式把可选字段清空」这一语义。
    // 端口类型不动（其它实现共享），只在这一处用 unknown 中转一次；
    // mergePluginArtifact 用 'operatorContract' in patch 判定，undefined 会 delete 掉旧值。
    const patch = contract === undefined
      ? { operatorContract: undefined }
      : { operatorContract: JSON.parse(JSON.stringify(contract)) as NonNullable<PluginArtifact['operatorContract']> };
    await this.store.update(id, patch as unknown as Partial<PluginArtifact>);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }

  /**
   * 改一件插件工件的 id（keyPath）。只换标识，code / version / history /
   * enabled / slug / catalogRef 全部原样，不产生新版本、不触发试算。
   * 调用方（PluginTools / 面板）负责校验新 id 合法与重名，并同步赛事页选中键。
   */
  async renameId(oldId: string, newId: string): Promise<PluginArtifact> {
    const existing = await this.requireArtifact(oldId);
    if (oldId === newId) return existing;
    if ((await this.store.get(newId)) !== null) {
      throw new Error(`目标 id ${newId} 已被另一件插件占用；换一个不重名的 id`);
    }
    await this.store.replaceId(oldId, newId);
    const moved = await this.store.get(newId);
    if (moved === null) throw new Error(`改名后读不到插件 ${newId}，存储可能不可用`);
    return moved;
  }

  async get(id: string): Promise<PluginArtifact | null> {
    return this.store.get(id);
  }

  async list(): Promise<PluginArtifact[]> {
    return this.store.list();
  }

  /**
   * 阶段一算子表地基：只读「已启用」工件快照（人工启用闸门）。
   * pointId 等进一步过滤由调用方（OperatorRegistry）按扩展点决定，
   * 这里不写死任何扩展点，保持工件服务的通用性。
   * 存储/装配失败由调用方按空集降级（与旧 listActive 口径一致）。
   */
  async listActive(): Promise<PluginArtifact[]> {
    const all = await this.store.list();
    return all.filter((a) => a.enabled);
  }

  private async requireArtifact(id: string): Promise<PluginArtifact> {
    const artifact = await this.store.get(id);
    if (artifact === null) {
      throw new Error(`Plugin artifact "${id}" not found`);
    }
    return artifact;
  }
}
