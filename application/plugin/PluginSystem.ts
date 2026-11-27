/**
 * 插件系统装配根（composition root）
 * @module application/plugin/PluginSystem
 *
 * 把各层端口粘成一个可注入到页面的完整系统。所有构造都在这里完成，
 * 页面只拿 `toolKit` / `applyRanking` 等入口，不关心 IndexedDB、Worker、wasm 细节。
 *
 * 关键性质：插件对 LLM 随时可见（数据来自工件存储，不是会话历史），
 * 因此新会话、老会话、会话清空后都能查看与修订插件。
 *
 * 2026-11-14：旧的自造 JSON 动作协议 + 双层循环 + verifier 全部删除，
 * 改为「一张工具表挂到通用 tool-calling loop」。`toolKit` 是聊天侧 plugin
 * 角色唯一需要的东西；调试/启停/历史/回滚/应用等都在工具集里，和 UI 面板
 * 共用同一批 service。
 *
 * 2026-11-21：装配根创建扩展点行为注册表并注入 toolKit / catalog，
 * 框架只认 ExtensionPointBehavior 契约，ranking / workflow-operator / 未来扩展点平级；
 * applyRanking 是赛事页的业务入口，仍走唯一管线 computeRanking(matches, impl)。
 */

import type { IModelGateway } from '@application/model/IModelGateway';
import type { IPluginRuntime, PluginArtifact } from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import type { MatchData, RankingTable } from '@domain/ranking/types';
import { computeRanking, BuiltinRanking } from '@domain/ranking/RankingPipeline';
import { OpenAIModelGateway } from '@infrastructure/llm/OpenAIModelGateway';
import { QuickJsRuntime } from '@infrastructure/plugin-vm/QuickJsRuntime';
import { createPluginArtifactStore } from '@infrastructure/plugin/PluginArtifactStore';
import { InMemoryPluginArtifactStore } from '@infrastructure/plugin/InMemoryPluginArtifactStore';
import { LocalStorageAdapter } from '@infrastructure/storage/adapters/web/LocalStorageAdapter';
import { PluginValidator } from '@domain/plugin/PluginValidator';
import { PluginArtifactService } from './PluginArtifactService';
import { PluginContextProvider } from './PluginContextProvider';
import { createPluginToolKit, type PluginToolKit } from './PluginTools';
import { createExtensionPointBehaviors } from './behaviors';
import { createPluginRanking } from './RankingPluginAdapter';
import { loadPluginMaxAttempts } from './PluginConfig';
import { safeReply, DEFAULT_REPLY_MAX_CHARS } from '../chat/safeReply';

export { DEFAULT_PLUGIN_MAX_ATTEMPTS, loadPluginMaxAttempts, savePluginMaxAttempts } from './PluginConfig';

/** 赛事页「当前选中的排名插件」持久化口径（与 EventDetailPage.ts 完全一致） */
const RANKING_PLUGIN_KEY = 'event-ranking-plugin';
const LOCAL_STORE_NAMESPACE = 'weiqi-bot';

export interface PluginSystemOptions {
  /** 注入自定义网关（测试用）；不传则新建 OpenAIModelGateway */
  gateway?: IModelGateway;
  /** 注入自定义运行时（测试用）；不传则用浏览器 Worker 版 */
  runtime?: IPluginRuntime;
  /** 注入自定义工件存储（测试用）；不传则用 IndexedDB */
  store?: PluginArtifactStoreLike;
  /** 是否用内存存储（Node/测试环境） */
  useMemoryStore?: boolean;
  /** 内部延续预算；对应自主决策次数减 1（/llm repairs 对用户显示决策次数） */
  maxAttempts?: number;
  /** 注入自定义本地存储（测试用）；不传则按 namespace 新建 */
  localStorage?: LocalStorageAdapter;
  /** wasm 二进制提供者；不传则按 public 目录路径 fetch */
  wasmBinary?: ArrayBuffer | (() => Promise<ArrayBuffer>);
  /** 工件集合 / enabled 状态成功变更后刷新算子表快照；透传给 createPluginToolKit */
  onArtifactChange?: () => void | Promise<void>;
}

export interface PluginArtifactStoreLike {
  list(): Promise<PluginArtifact[]>;
  get(id: string): Promise<PluginArtifact | null>;
  create(a: PluginArtifact): Promise<void>;
  update(id: string, patch: Partial<PluginArtifact>): Promise<void>;
  remove(id: string): Promise<void>;
  /** keyPath 换 id：与 IPluginArtifactStore.replaceId 同形（见 domain/plugin/types.ts） */
  replaceId(oldId: string, newId: string): Promise<void>;
}

/** wasm 默认加载：public/plugin/quickjs-release-sync.wasm，绝对路径避开子页面相对路径坑 */
function defaultWasmBinary(): () => Promise<ArrayBuffer> {
  return async () => {
    const url = `${location.origin}/plugin/quickjs-release-sync.wasm`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wasm 资源加载失败：${res.status} ${url}`);
    return res.arrayBuffer();
  };
}

/** Worker 工厂：Vite 的 new Worker(new URL(...), {type:'module'}) 标准写法 */
function browserWorkerFactory(): Worker {
  return new Worker(
    new URL('../../infrastructure/plugin-vm/sandbox.worker.ts', import.meta.url),
    { type: 'module' },
  );
}

export interface PluginSystem {
  gateway: IModelGateway;
  runtime: IPluginRuntime;
  artifacts: PluginArtifactService;
  snapshot: PluginContextProvider;
  /** 挂到通用 ToolLoop 的插件工具集（plugin 角色唯一入口） */
  toolKit: PluginToolKit;
  /** 内部预算值；ToolLoop.maxTurns = maxAttempts + 1，即用户设置的自主决策次数 */
  maxAttempts: number;
  /**
   * 给排名页用：把同一份原始对阵表交给唯一管线 computeRanking。
   * - 只有显式传入选中的插件 id 时才构造插件 impl（否则一律内置，避免加载 wasm）
   * - 插件「已启用」只是可用性闸门，不等于「当前正在使用」——由页面菜单决定
   * - 插件执行/校验失败一律回落内置（标准口径）结果，保证页面不白屏
   */
  applyRanking(matches: MatchData[], selectedArtifactId?: string): Promise<RankingTable>;
  /**
   * 改一件插件的 id 并同步「赛事页当前选中的排名插件」持久化键。
   * 工具集（plugin_rename）与面板「改 ID」按钮共用这一份，避免两边口径漂移。
   */
  renameArtifact(oldId: string, newId: string): Promise<PluginArtifact>;
  /** 装配根持有的扩展点行为注册表；在线平台与工具集共用同一份 */
  behaviors: ReturnType<typeof createExtensionPointBehaviors>;
  /** 渲染前安全处理 LLM 文本 */
  safeReply(text: string): string;
  dispose(): Promise<void>;
}

/** 创建完整插件系统 */
export async function createPluginSystem(options: PluginSystemOptions = {}): Promise<PluginSystem> {
  const maxAttempts = options.maxAttempts ?? loadPluginMaxAttempts();
  const gateway = options.gateway ?? new OpenAIModelGateway();

  const store: PluginArtifactStoreLike = options.store
    ?? (options.useMemoryStore ? new InMemoryPluginArtifactStore() : await createPluginArtifactStore());

  const runtime = options.runtime ?? new QuickJsRuntime({
    workerFactory: browserWorkerFactory,
    wasmBinary: options.wasmBinary ?? defaultWasmBinary(),
  });

  const artifacts = new PluginArtifactService(store);
  const snapshot = new PluginContextProvider(store);
  const validator = new PluginValidator();
  // 唯一的业务接线点：ranking / workflow-operator / 未来扩展点在这里平级注册，
  // 框架各层只按 pointId 查这张表，不再硬编码分派。
  const behaviors = createExtensionPointBehaviors();

  // 赛事页选择键：与 EventDetailPage 用同一个 namespace / key / write/delete 口径。
  // 工具集不依赖具体存储实现，通过窄函数注入。
  const localStore = options.localStorage ?? new LocalStorageAdapter(LOCAL_STORE_NAMESPACE);
  try { await localStore.initialize(); } catch { /* 存储不可用时应用工具会明确失败 */ }
  const applySelection = async (id: string | undefined): Promise<void> => {
    if (id) await localStore.write(RANKING_PLUGIN_KEY, id);
    else await localStore.delete(RANKING_PLUGIN_KEY);
  };
  /**
   * 改插件 id 后同步赛事页「当前选中的排名插件」：
   * 只有键里存的正是旧 id 才改写成新 id；存的是别的插件 / 没选中则一律不动。
   * 与 EventDetailPage 用同一个 namespace / key / read 口径（见其 RANKING_PLUGIN_KEY）。
   */
  const onArtifactRenamed = async (oldId: string, newId: string): Promise<void> => {
    const selected = localStore.readSync<string | null>(RANKING_PLUGIN_KEY);
    if (selected === oldId) await localStore.write(RANKING_PLUGIN_KEY, newId);
  };
  const renameArtifact = async (oldId: string, newId: string): Promise<PluginArtifact> => {
    const moved = await artifacts.renameId(oldId, newId);
    await onArtifactRenamed(oldId, newId);
    await options.onArtifactChange?.();
    return moved;
  };

  // 先取一次再窄化：exactOptionalPropertyTypes 下可选字段要么整个键省略、要么给确定值，
  // 绝不塞 undefined。
  const onArtifactChange = options.onArtifactChange;
  const toolKit = createPluginToolKit({
    artifacts,
    runtime,
    validator,
    snapshot,
    applySelection,
    onArtifactRenamed,
    behaviors,
    maxAttempts,
    ...(onArtifactChange !== undefined ? { onArtifactChange } : {}),
  });

  return {
    gateway,
    runtime,
    artifacts,
    snapshot,
    toolKit,
    behaviors,
    renameArtifact,
    maxAttempts,
    applyRanking: async (matches: MatchData[], selectedArtifactId?: string) => {
      const builtin = (): Promise<RankingTable> => computeRanking(matches, new BuiltinRanking());
      if (!selectedArtifactId) return builtin();
      let active: PluginArtifact | undefined;
      try {
        const all = await artifacts.list();
        active = all.find((a) =>
          a.id === selectedArtifactId && a.enabled && a.pointId === RANKING_SPEC.pointId,
        );
      } catch {
        return builtin();
      }
      if (!active) return builtin();
      try {
        return await computeRanking(matches, createPluginRanking(active.code, { runtime }));
      } catch {
        return builtin();
      }
    },
    safeReply: (text: string) => safeReply(text, DEFAULT_REPLY_MAX_CHARS),
    dispose: () => runtime.dispose(),
  };
}

// 保留对外复用（既有模块/测试依赖这两个导出，与旧链路无关）
export { describeInputShape, sanitizeFeedback } from './FeedbackPack';
