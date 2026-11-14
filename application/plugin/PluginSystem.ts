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
 * 共用同一批 service。排名仍只有一条管线 computeRanking(matches, impl)。
 */

import type { IModelGateway } from '@application/model/IModelGateway';
import type { IPluginRuntime, PluginArtifact } from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import type { MatchData, RankingTable, RankingMode } from '@domain/ranking/types';
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
  /** 决策轮数上限（沿用 /llm repairs 的同一配置） */
  maxAttempts?: number;
  /** 注入自定义本地存储（测试用）；不传则按 namespace 新建 */
  localStorage?: LocalStorageAdapter;
  /** wasm 二进制提供者；不传则按 public 目录路径 fetch */
  wasmBinary?: ArrayBuffer | (() => Promise<ArrayBuffer>);
}

export interface PluginArtifactStoreLike {
  list(): Promise<PluginArtifact[]>;
  get(id: string): Promise<PluginArtifact | null>;
  create(a: PluginArtifact): Promise<void>;
  update(id: string, patch: Partial<PluginArtifact>): Promise<void>;
  remove(id: string): Promise<void>;
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
  /** 决策轮数上限：ToolLoop.maxTurns = maxAttempts + 1（沿用既有 /llm repairs 配置） */
  maxAttempts: number;
  /**
   * 给排名页用：把同一份原始对阵表交给唯一管线 computeRanking。
   * - 只有显式传入选中的插件 id 时才构造插件 impl（否则一律内置，避免加载 wasm）
   * - 插件「已启用」只是可用性闸门，不等于「当前正在使用」——由页面菜单决定
   * - 插件执行/校验失败一律回落内置结果，保证页面不白屏
   * - mode 只影响内置实现的预设口径，插件忽略
   */
  applyRanking(matches: MatchData[], selectedArtifactId?: string, mode?: RankingMode): Promise<RankingTable>;
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

  // 赛事页选择键：与 EventDetailPage 用同一个 namespace / key / write/delete 口径。
  // 工具集不依赖具体存储实现，通过窄函数注入。
  const localStore = options.localStorage ?? new LocalStorageAdapter(LOCAL_STORE_NAMESPACE);
  try { await localStore.initialize(); } catch { /* 存储不可用时应用工具会明确失败 */ }
  const applySelection = async (id: string | undefined): Promise<void> => {
    if (id) await localStore.write(RANKING_PLUGIN_KEY, id);
    else await localStore.delete(RANKING_PLUGIN_KEY);
  };

  const toolKit = createPluginToolKit({
    artifacts,
    runtime,
    validator,
    snapshot,
    applySelection,
    maxAttempts,
  });

  return {
    gateway,
    runtime,
    artifacts,
    snapshot,
    toolKit,
    maxAttempts,
    applyRanking: async (matches: MatchData[], selectedArtifactId?: string, mode: RankingMode = 'default') => {
      const builtin = (): Promise<RankingTable> => computeRanking(matches, new BuiltinRanking(mode));
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
