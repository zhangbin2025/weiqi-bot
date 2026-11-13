/**
 * 插件代码生成 / 修订用例（工件中心 + 自动修复循环）
 * @module application/plugin/PluginCodegenUseCase
 *
 * 关键性质：
 * - 修复循环的输入只依赖「工件 + 本次反馈」，不读任何聊天会话历史。
 *   会话清空、换设备、老会话都不影响能力。
 * - 每轮 LLM 输出完整代码（不是 diff），且每轮都重新全量校验 + 全新沙箱执行。
 * - 轮数可配置（默认 3），失败不自动生效，保留最后一版供人工处理。
 */

import type { IModelGateway, ModelMessage } from '@application/model/IModelGateway';
import type {
  IPluginRuntime,
  PluginSpec,
  PluginRunResult,
  RepairFeedback,
  AgentResponse,
  PluginTraceStep,
  PluginTraceSink,
} from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import { SAMPLE_RANKING_INPUT, validateRankingOutput } from '@domain/ranking';
import type { IInstructionVerifier, VerificationResult } from './InstructionVerifier';

/** 校验器端口（实现见 domain/plugin/PluginValidator） */
export interface ICodeValidator {
  validate(code: string, spec: PluginSpec): { ok: boolean; reason?: string };
}

/** system prompt 构造端口 */
export interface IPromptBuilder {
  agentSystemPrompt(snapshot: unknown[], maxAttempts: number): string;
  /** codegen 专用极简 prompt；不传则回落 agentSystemPrompt（兼容旧装配/测试） */
  codegenSystemPrompt?(snapshot: unknown[], maxAttempts: number): string;
  buildRepairMessages(
    intent: string,
    code: string | undefined,
    feedback: RepairFeedback | string,
    maxAttempts: number,
    instruction?: string,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

/** 响应解析端口 */
export interface IAgentProtocol {
  parse(raw: string): { ok: true; response: AgentResponse } | { ok: false; reason: string };
}

/** 反馈归一端口 */
export interface IFeedbackAdapter {
  toFeedback(
    runResult: PluginRunResult,
    attempt: number,
    maxAttempts: number,
    inputShape?: string,
  ): RepairFeedback;
}

export interface PluginCodegenOptions {
  gateway: IModelGateway;
  runtime: IPluginRuntime;
  validator: ICodeValidator;
  prompts: IPromptBuilder;
  protocol: IAgentProtocol;
  feedback: IFeedbackAdapter;
  maxAttempts: number;
  /** 可选：指令满足度验证器；不注入则修订只做 diff 检测（轻量档） */
  verifier?: IInstructionVerifier;
}

export interface CodegenRequest {
  intent: string;
  /** 修订时的当前代码；首次生成传 undefined */
  currentCode?: string;
  /** 本轮增量指令（用户原话）。修订时由 agent 显式传入，不与 intent/feedback 混同 */
  revisionRequest?: string;
  /** 用户验收反馈（可选），有则作为首轮反馈 */
  userFeedback?: string;
  /** 沙箱试算输入；不传则使用代表性对阵样例（含轮空、含未完赛） */
  sampleInput?: unknown;
  spec?: PluginSpec;
  /** 注入 system prompt 的插件清单快照 */
  snapshot?: unknown[];
  /** 实时过程推送：每产生一步立刻回调一次（不等待整轮结束） */
  onTrace?: PluginTraceSink;
}

export interface CodegenResult {
  ok: boolean;
  code: string;
  output?: unknown;
  attempts: number;
  lastFeedback?: RepairFeedback;
  /** LLM 给出的回复文本（成功时可用于渲染） */
  reply: string;
  /** 逐轮调试过程（供对话页折叠展示，不写进会话历史） */
  trace: PluginTraceStep[];
}

/**
 * 从 LLM 文本里稳健提取代码。
 * codegen 阶段模型应直接输出 JS 源码（可带 ```js 围栏）；
 * 兼容旧版 {reply,action:{code}} JSON，但**不再依赖动作协议**——
 * 协议解析失败时也要从原始文本抢救代码，避免「plugin.revise 缺 artifactId」
 * 这类与写代码无关的错误把整轮废掉。
 */
function extractCode(parsed: AgentResponse | undefined, raw: string): string | undefined {
  const trimmed = raw.trim();

  // 1) 代码围栏（codegen 的主输出形态）
  const fenced = trimmed.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced && fenced.trim()) return fenced.trim();

  // 2) 兼容旧动作协议里的 action.code
  const actionCode = parsed?.action?.code;
  if (typeof actionCode === 'string' && actionCode.trim()) return actionCode.trim();

  // 3) 纯 JS 源码：必须含 rank 入口，且不是 JSON 对象
  if (!trimmed.startsWith('{') && /\bfunction\s+rank\s*\(|\brank\s*=\s*(?:function|\()/.test(trimmed)) {
    return trimmed;
  }

  // 4) 兜底：JSON 字符串里的 code 字段（提取失败也别丢）
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      const direct = typeof o['code'] === 'string' ? o['code'] : undefined;
      const nested = o['action'] && typeof o['action'] === 'object'
        ? (o['action'] as Record<string, unknown>)['code'] : undefined;
      const candidate = direct ?? (typeof nested === 'string' ? nested : undefined);
      if (candidate && candidate.trim() && /\brank\s*\(/.test(candidate)) return candidate.trim();
    }
  } catch { /* 不是 JSON，忽略 */ }

  return undefined;
}

export class PluginCodegenUseCase {
  constructor(private readonly options: PluginCodegenOptions) {}

  async run(req: CodegenRequest): Promise<CodegenResult> {
    const spec = req.spec ?? RANKING_SPEC;
    // 不在空数组上「试算通过」：默认给模型一份真实形状的对阵表
    const sampleInput = req.sampleInput ?? SAMPLE_RANKING_INPUT;
    const sampleMatches = (sampleInput as { matches?: unknown }).matches;
    const validationInput = Array.isArray(sampleMatches)
      ? { matches: sampleMatches as import('@domain/ranking/types').MatchData[] }
      : { matches: [] };
    const maxAttempts = Math.max(1, this.options.maxAttempts);
    let code: string | undefined = req.currentCode;
    let lastFeedback: RepairFeedback | undefined;
    let reply = '';
    // 修订态：有「当前代码」或「本轮指令」即视为修订（标准 edit(state, instruction) -> state'）
    const isRevision = Boolean(req.currentCode || req.revisionRequest);
    // 原始 state：给 verifier 当 previousCode（验收「相对最初的净改动」），
    // 也是 diff 检测的第二个基准，防止「改了两轮又绕回原样」被放过。
    // 每轮给模型看的 state 则是上一轮候选（code），标准逐轮 edit 形状。
    const baseCode = req.currentCode ?? '';
    // 本轮指令原样保留，每轮透传、每轮验收
    const instruction = req.revisionRequest ?? '';
    const trace: PluginTraceStep[] = [];
    const push = (stepAttempt: number, phase: string, ok: boolean, detail: string, stepCode?: string): void => {
      const step: PluginTraceStep = { source: 'codegen', attempt: stepAttempt, phase, ok, detail };
      if (stepCode !== undefined) step.code = stepCode;
      trace.push(step);
      // 实时推送：单步失败不影响代码生成主流程（纯展示通道）
      try { req.onTrace?.(step); } catch { /* ignore */ }
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const messages = this.options.prompts.buildRepairMessages(
        req.intent,
        code,
        lastFeedback ?? req.userFeedback ?? '请根据需求输出完整插件代码',
        maxAttempts,
        instruction || undefined,
      );
      // codegen 用独立极简 prompt（不含任何插件动作/artifactId 字样）；
      // 端口未注入时回落旧行为，保证测试与旧装配可用。
      const buildSystem = this.options.prompts.codegenSystemPrompt ?? this.options.prompts.agentSystemPrompt;
      const systemText = buildSystem(req.snapshot ?? [], maxAttempts);
      // 修订 system 必须接上：它明确「只输出完整源码、不给 JSON 动作协议」。
      const repairSystem = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const modelMessages: ModelMessage[] = [
        { role: 'system', content: repairSystem ? `${systemText}\n\n${repairSystem}` : systemText },
        ...messages.filter((m) => m.role !== 'system').map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      let raw: string;
      try {
        // 先推「开始」再 await：模型调用可能耗时几十秒，过程块必须在这期间
        // 就已经点亮并逐步更新，否则用户会觉得「开发完了才突然冒出过程」。
        push(attempt, 'llm', true, `第 ${attempt}/${maxAttempts} 轮：正在调用模型生成/修订代码…`);
        const result = await this.options.gateway.execute({
          task: 'plugin.generate',
          messages: modelMessages,
          // codegen 输出的是整段 JS 源码，不是 JSON 对象；
          // 强制 jsonMode 会把源码塞进字符串导致转义破损（expecting '(' 的来源）。
          options: { jsonMode: false },
        });
        raw = result.text;
        push(attempt, 'llm', true, `第 ${attempt}/${maxAttempts} 轮：模型已返回（${raw.length} 字符）`);
      } catch (error) {
        push(attempt, 'llm', false, `第 ${attempt}/${maxAttempts} 轮：模型调用失败 ${error instanceof Error ? error.message : String(error)}`);
        return {
          ok: false,
          code: code ?? '',
          attempts: attempt,
          reply: `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
          trace,
        };
      }

      // 先尽力从原始文本抠代码；协议只作为「兼容旧 JSON 输出」的辅助，
      // 它的失败不再等于本轮失败（模型没发 action 是正常的）。
      const parsed = this.options.protocol.parse(raw);
      const nextCode = extractCode(parsed.ok ? parsed.response : undefined, raw);
      // 纯源码输出没有动作协议里的 reply，给一个可展示的兜底文案
      if (parsed.ok) reply = parsed.response.reply;
      else if (nextCode) reply = reply || '已生成插件源码';
      if (!nextCode) {
        const reason = parsed.ok ? '模型没有输出 JS 源码' : '模型没有输出可识别的 JS 源码';
        push(attempt, 'protocol', false, `第 ${attempt}/${maxAttempts} 轮：未拿到完整代码 — ${reason}`);
        lastFeedback = {
          phase: 'contract',
          ok: false,
          error: { name: 'ProtocolError', message: reason },
          hint: '请直接输出完整的 function rank(input){ ... } 源码（可用 ```js 围栏），不要解释、不要 JSON 动作协议、不要 diff',
          attempt,
          maxAttempts,
        };
        continue;
      }
      // 显式变更检测（不变式 3）：修订时两种「没改」都直接回喂、不进入后续验收：
      //  a. 原样照抄本轮 state，即上一轮候选或首次的原始源码 —— 模型卡住重复输出；
      //  b. 净改动为零：绕几轮又改回原始 baseCode —— 交付的还是没改的代码。
      // 比对时忽略首尾空白差异，任何实质内容变化都算改动。
      const sameAsState = nextCode.trim() === (code ?? '').trim();
      const sameAsBase = Boolean(baseCode) && nextCode.trim() === baseCode.trim();
      if (isRevision && (sameAsState || sameAsBase)) {
        push(attempt, 'diff', false, `第 ${attempt}/${maxAttempts} 轮：输出与改动基点完全相同，未做任何修改`);
        lastFeedback = {
          phase: 'user',
          ok: false,
          error: { name: 'NoChangeError', message: '代码没有任何改动' },
          hint: `你没有修改代码。请严格按【本轮修改要求】给出改动后的完整源码，不要原样照抄当前源码。本轮修改要求：${instruction || '（未提供，请按用户反馈修订）'}`,
          attempt,
          maxAttempts,
        };
        continue;
      }
      code = nextCode;
      push(attempt, 'llm', true, `第 ${attempt}/${maxAttempts} 轮：提取到完整源码（${code.length} 字符）`, code);

      // 每轮都全量校验（LLM 在修复时可能试探越权 API）
      const check = this.options.validator.validate(code, spec);
      if (!check.ok) {
        push(attempt, 'validate', false, `第 ${attempt}/${maxAttempts} 轮：代码校验未通过 — ${check.reason ?? '代码校验失败'}`);
        lastFeedback = {
          phase: 'contract',
          ok: false,
          error: { name: 'ValidationError', message: check.reason ?? '代码校验失败' },
          hint: '代码包含不允许的写法或超出体积限制，请重写完整代码',
          attempt,
          maxAttempts,
        };
        continue;
      }

      // 每轮都是全新沙箱（一次性 Worker 由 runtime 保证）
      let runResult: PluginRunResult;
      try {
        runResult = await this.options.runtime.run(code, sampleInput, spec);
      } catch (error) {
        push(attempt, 'sandbox', false, `第 ${attempt}/${maxAttempts} 轮：沙箱异常 ${error instanceof Error ? error.message : String(error)}`);
        runResult = {
          ok: false,
          phase: 'crash',
          error: { name: 'RuntimeError', message: error instanceof Error ? error.message : String(error) },
          logs: [],
          elapsedMs: 0,
        };
      }

      if (runResult.ok) {
        // 「能跑」不等于「符合统一契约」：开发期就用生产同一份校验拦住列/单元格错误
        const check = validateRankingOutput(runResult.output, validationInput);
        if (!check.ok) {
          const hint = check.hint ?? '排名表不符合契约';
          push(attempt, 'contract', false, `第 ${attempt}/${maxAttempts} 轮：输出契约不符 — ${hint}`, code);
          // 回喂试算输入的实际形状与选手清单，让模型能直接对照修 rows，
          // 而不是只收到一句「必须覆盖全部选手」的通用提示。
          const ids = validationInput.matches.flatMap((m) => [
            m.p1Id && m.p1Name ? `${m.p1Id}:${m.p1Name}` : '',
            m.p2Id && m.p2Name ? `${m.p2Id}:${m.p2Name}` : '',
          ]).filter(Boolean);
          const shape = `试算输入 matches 共 ${validationInput.matches.length} 场；真实选手 = [${[...new Set(ids)].join(', ')}]；`
            + `id=0 或姓名为空是轮空，不进 rows（但另一侧的比分照常计入）；未完赛为双方比分全 0。`;
          lastFeedback = {
            phase: 'contract',
            ok: false,
            error: { name: 'ContractError', message: hint },
            contract: { entryFound: false, outputIsArray: false, missingFields: check.missingFields },
            hint: `${hint}。${shape} 必须返回 { columns, rows }，列名为汉字，cells 只能是数值或数值数组，rows 恰好覆盖上述选手。`,
            attempt,
            maxAttempts,
          };
          continue;
        }
        push(attempt, 'sandbox', true, `第 ${attempt}/${maxAttempts} 轮：沙箱试算通过（${runResult.elapsedMs}ms）`);

        // 验收 = 指令满足度（业界 C：生成→验证→修订）。
        // 「能跑 / 合契约」只是必要条件；修订时还要单独判定「是否按本轮指令改了」。
        if (isRevision && this.options.verifier) {
          let verdict: VerificationResult;
          try {
            verdict = await this.options.verifier.verify({
              spec: req.intent,
              instruction: instruction || req.userFeedback || '（用户要求修改插件，但未给出具体指令）',
              previousCode: baseCode,
              candidateCode: code,
            });
          } catch (error) {
            // 验证器自身异常也不打回正确代码，但显式记一步，不静默
            verdict = {
              satisfied: false,
              available: false,
              reason: `验证器异常（不据此打回）：${error instanceof Error ? error.message : String(error)}`,
            };
          }
          if (!verdict.available) {
            push(attempt, 'verify', false, `第 ${attempt}/${maxAttempts} 轮：${verdict.reason}`);
            // fail-open：判定不可采信时不回环，但用户能在过程里看到「未判定」
          } else if (!verdict.satisfied) {
            push(attempt, 'verify', false, `第 ${attempt}/${maxAttempts} 轮：指令未满足 — ${verdict.reason}`);
            lastFeedback = {
              phase: 'user',
              ok: false,
              error: { name: 'InstructionError', message: '未满足本轮修改要求' },
              hint: `验证判定：候选代码没有按【本轮修改要求】改到位。还差什么：${verdict.reason}。请照此重写完整源码，本轮修改要求：${instruction || req.userFeedback || '（未提供）'}`,
              attempt,
              maxAttempts,
            };
            continue;
          } else {
            push(attempt, 'verify', true, `第 ${attempt}/${maxAttempts} 轮：指令满足度通过`);
          }
        }

        return { ok: true, code, output: runResult.output, attempts: attempt, reply, trace };
      }
      push(attempt, 'sandbox', false, `第 ${attempt}/${maxAttempts} 轮：试算失败 [${runResult.phase}] ${runResult.error?.message ?? runResult.hint ?? '未知'}`, code);
      lastFeedback = this.options.feedback.toFeedback(runResult, attempt, maxAttempts);
    }

    return {
      ok: false,
      code: code ?? '',
      attempts: maxAttempts,
      ...(lastFeedback ? { lastFeedback } : {}),
      reply: `已尝试 ${maxAttempts} 轮仍未得到可用插件，请调整描述或手动修改代码。`,
      trace,
    };
  }
}
