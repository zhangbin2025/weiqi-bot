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
  PluginRevision,
  PluginSpec,
} from '../../domain/plugin/types';

export interface CreatePluginArtifactInput {
  name: string;
  intent: string;
  code: string;
  pointId: ExtensionPointId;
  origin: PluginArtifact['origin'];
  spec: PluginSpec;
  scope?: { eventId?: number };
  conversationRef?: string;
}

export interface RevisePluginArtifactInput {
  /** 永远是全量源码，不是 diff */
  code: string;
  trigger: PluginRevision['trigger'];
  feedback?: string;
  /** 省略表示这版代码被采纳为当前生效版本 */
  outcome?: PluginRevision['outcome'];
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
      id: generateArtifactId(at),
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
    };
    // 只提交变化字段，依赖 store 的 merge 语义保留 intent/spec/scope 等。
    await this.store.update(id, {
      code: updated.code,
      version: updated.version,
      updatedAt: updated.updatedAt,
      history: updated.history,
    });
    return updated;
  }

  /** 人工闸门：显式启用 / 停用；顺带刷新 updatedAt 让清单排序反映这次变更 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.requireArtifact(id);
    await this.store.update(id, { enabled, updatedAt: this.clock() });
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }

  async get(id: string): Promise<PluginArtifact | null> {
    return this.store.get(id);
  }

  async list(): Promise<PluginArtifact[]> {
    return this.store.list();
  }

  private async requireArtifact(id: string): Promise<PluginArtifact> {
    const artifact = await this.store.get(id);
    if (artifact === null) {
      throw new Error(`Plugin artifact "${id}" not found`);
    }
    return artifact;
  }
}
