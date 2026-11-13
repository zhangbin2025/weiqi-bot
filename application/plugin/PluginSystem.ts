/**
 * 插件系统装配根（composition root）
 * @module application/plugin/PluginSystem
 *
 * 把各层端口粘成一个可注入到页面的完整系统。所有构造都在这里完成，
 * 页面只拿 `agent` / `applyRanking` 等入口，不关心 IndexedDB、Worker、wasm 细节。
 *
 * 关键性质：插件对 LLM 随时可见（数据来自工件存储，不是会话历史），
 * 因此新会话、老会话、会话清空后都能查看与修订插件。
 *
 * 排名只有一条管线 computeRanking(matches, impl)：内置实现与插件实现
 * 都是同一个 IRankingImplementation，本装配根只负责「选中哪个 impl」。
 */

import type { IModelGateway } from '@application/model/IModelGateway';
import type { IPluginRuntime, PluginSpec, PluginArtifact } from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import type { MatchData, RankingTable, RankingMode } from '@domain/ranking/types';
import { computeRanking, BuiltinRanking } from '@domain/ranking/RankingPipeline';
import { OpenAIModelGateway } from '@infrastructure/llm/OpenAIModelGateway';
import { QuickJsRuntime } from '@infrastructure/plugin-vm/QuickJsRuntime';
import { createPluginArtifactStore } from '@infrastructure/plugin/PluginArtifactStore';
import { InMemoryPluginArtifactStore } from '@infrastructure/plugin/InMemoryPluginArtifactStore';
import { PluginValidator } from '@domain/plugin/PluginValidator';
import { PluginArtifactService } from './PluginArtifactService';
import { PluginContextProvider } from './PluginContextProvider';
import { buildAgentSystemPrompt, buildCodegenSystemPrompt, buildRepairMessages } from './PluginPrompts';
import { toFeedback, sanitizeFeedback, describeInputShape } from './FeedbackPack';
import { parseAgentResponse, safeAgentReply } from './AgentProtocol';
import { InstructionVerifier } from './InstructionVerifier';
import { PluginCodegenUseCase } from './PluginCodegenUseCase';
import { PluginAgentUseCase } from './PluginAgentUseCase';
import { createPluginRanking } from './RankingPluginAdapter';
import { loadPluginMaxAttempts } from './PluginConfig';

export { DEFAULT_PLUGIN_MAX_ATTEMPTS, loadPluginMaxAttempts, savePluginMaxAttempts } from './PluginConfig';

/** 对话页智能体用的提示词（含插件动作协议） */
const prompts = {
  agentSystemPrompt: buildAgentSystemPrompt,
  buildRepairMessages,
};

/** codegen 专用：极简契约 prompt，不带任何插件动作/artifactId 语义 */
const codegenPrompts = {
  ...prompts,
  codegenSystemPrompt: buildCodegenSystemPrompt,
};

const protocol = { parse: parseAgentResponse };

const feedbackAdapter = {
  toFeedback,
};

/** 把 PluginArtifactService 适配成 PluginAgentUseCase 期望的窄接口 */
function artifactPort(service: PluginArtifactService): PluginAgentUseCaseArtifacts {
  return {
    create: async (input) => {
      const a = await service.create(input);
      return { id: a.id };
    },
    revise: async (id, input) => {
      const a = await service.revise(id, input);
      return { id: a.id };
    },
    setEnabled: (id, enabled) => service.setEnabled(id, enabled),
    remove: (id) => service.remove(id),
    get: async (id) => {
      const a = await service.get(id);
      return a ? { id: a.id, code: a.code, intent: a.intent, spec: a.spec } : null;
    },
  };
}

interface PluginAgentUseCaseArtifacts {
  create(input: {
    name: string; intent: string; code: string; pointId: string;
    origin: 'llm' | 'manual'; spec: PluginSpec; conversationRef?: string;
  }): Promise<{ id: string }>;
  revise(id: string, input: {
    code: string; trigger: 'create' | 'auto-repair' | 'user-feedback' | 'manual';
    feedback?: string;
  }): Promise<{ id: string }>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<{ id: string; code: string; intent: string; spec: PluginSpec } | null>;
}

export interface PluginSystemOptions {
  /** 注入自定义网关（测试用）；不传则新建 OpenAIModelGateway */
  gateway?: IModelGateway;
  /** 注入自定义运行时（测试用）；不传则用浏览器 Worker 版 */
  runtime?: IPluginRuntime;
  /** 注入自定义工件存储（测试用）；不传则用 IndexedDB */
  store?: PluginArtifactStoreLike;
  /** 是否用内存存储（Node/测试环境） */
  useMemoryStore?: boolean;
  /** 自动修复轮数 */
  maxAttempts?: number;
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
  codegen: PluginCodegenUseCase;
  agent: PluginAgentUseCase;
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

  // 指令满足度验证器：只在修订时由 codegen 调用一次独立模型判定。
  // 注入为端口，测试可 mock；不注入时 codegen 自动退化为「只做 diff 检测」的轻量档。
  const verifier = new InstructionVerifier(gateway);

  const codegen = new PluginCodegenUseCase({
    gateway,
    runtime,
    validator,
    prompts: codegenPrompts,
    protocol,
    feedback: feedbackAdapter,
    verifier,
    maxAttempts,
  });

  const agent = new PluginAgentUseCase({
    gateway,
    prompts,
    protocol,
    validator,
    runtime,
    artifacts: artifactPort(artifacts),
    snapshot,
    codegen,
    maxAttempts,
  });

  return {
    gateway,
    runtime,
    artifacts,
    snapshot,
    codegen,
    agent,
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
    safeReply: (text: string) => safeAgentReply(text, 2000),
    dispose: () => runtime.dispose(),
  };
}

// 导出便于其它模块复用的工具（避免重复实现）
export { describeInputShape, sanitizeFeedback };
