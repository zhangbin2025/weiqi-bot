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

/** 校验器端口（实现见 domain/plugin/PluginValidator） */
export interface ICodeValidator {
  validate(code: string, spec: PluginSpec): { ok: boolean; reason?: string };
}

/** system prompt 构造端口 */
export interface IPromptBuilder {
  agentSystemPrompt(snapshot: unknown[], maxAttempts: number): string;
  buildRepairMessages(
    intent: string,
    code: string | undefined,
    feedback: RepairFeedback | string,
    maxAttempts: number,
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
}

export interface CodegenRequest {
  intent: string;
  /** 修订时的当前代码；首次生成传 undefined */
  currentCode?: string;
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

/** 从 LLM 文本里稳健提取代码：优先解析 {reply,action}，再兜底剥代码围栏 */
function extractCode(parsed: AgentResponse | undefined, raw: string): string | undefined {
  const actionCode = parsed?.action?.code;
  if (typeof actionCode === 'string' && actionCode.trim()) return actionCode.trim();
  const fenced = raw.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced && fenced.trim()) return fenced.trim();
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
      );
      // 保证 system prompt 含插件清单（智能体随时可见插件系统）
      const systemText = this.options.prompts.agentSystemPrompt(req.snapshot ?? [], maxAttempts);
      const modelMessages: ModelMessage[] = [
        { role: 'system', content: systemText },
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
          options: { jsonMode: true },
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

      const parsed = this.options.protocol.parse(raw);
      const nextCode = extractCode(parsed.ok ? parsed.response : undefined, raw);
      if (parsed.ok) reply = parsed.response.reply;
      if (!nextCode) {
        push(attempt, 'protocol', false, `第 ${attempt}/${maxAttempts} 轮：未拿到完整代码 — ${parsed.ok ? '未提供完整代码' : parsed.reason}`);
        lastFeedback = {
          phase: 'contract',
          ok: false,
          error: { name: 'ProtocolError', message: parsed.ok ? '未提供完整代码' : parsed.reason },
          hint: '请输出包含完整 code 的 JSON，不要只给解释或 diff',
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
          lastFeedback = {
            phase: 'contract',
            ok: false,
            error: { name: 'ContractError', message: hint },
            contract: { entryFound: false, outputIsArray: false, missingFields: check.missingFields },
            hint: '必须返回 { columns, rows }，列名为汉字，cells 只能是数值或数值数组，且覆盖全部选手',
            attempt,
            maxAttempts,
          };
          continue;
        }
        push(attempt, 'sandbox', true, `第 ${attempt}/${maxAttempts} 轮：沙箱试算通过（${runResult.elapsedMs}ms）`);
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
