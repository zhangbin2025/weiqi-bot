/**
 * 插件智能体用例（对话页主控台）
 * @module application/plugin/PluginAgentUseCase
 *
 * 对话页不再是「纯聊天」，而是智能体的主控台：
 *   每次请求都把插件系统快照注入 system prompt（插件随时可见）；
 *   LLM 产出 { reply, action }；客户端执行动作、观察结果、再决策。
 *
 * 工件中心：动作作用于 PluginArtifact，不依赖会话历史。
 * 人工闸门：plugin.create / plugin.revise 只产出「候选」，默认 enabled=false，
 *   必须经用户确认才生效；toggle/delete 属于显式用户意图，直接执行。
 */

import type { IModelGateway, ModelMessage } from '@application/model/IModelGateway';
import type {
  IPluginRuntime,
  PluginSpec,
  AgentResponse,
  AgentTurnResult,
  RepairFeedback,
  PluginContextEntry,
} from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';

export interface IAgentPrompts {
  agentSystemPrompt(snapshot: PluginContextEntry[], maxAttempts: number): string;
}

export interface IAgentProtocol {
  parse(raw: string): { ok: true; response: AgentResponse } | { ok: false; reason: string };
}

export interface ICodeValidator {
  validate(code: string, spec: PluginSpec): { ok: boolean; reason?: string };
}

export interface IPluginArtifactService {
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

export interface IPluginSnapshot {
  snapshot(): Promise<PluginContextEntry[]>;
}

export interface IPluginCodegen {
  run(req: {
    intent: string;
    currentCode?: string;
    userFeedback?: string;
    sampleInput: unknown;
    spec?: PluginSpec;
    snapshot?: PluginContextEntry[];
  }): Promise<{
    ok: boolean; code: string; output?: unknown; attempts: number;
    lastFeedback?: RepairFeedback; reply: string;
  }>;
}

export interface PluginAgentOptions {
  gateway: IModelGateway;
  prompts: IAgentPrompts;
  protocol: IAgentProtocol;
  validator: ICodeValidator;
  runtime: IPluginRuntime;
  artifacts: IPluginArtifactService;
  snapshot: IPluginSnapshot;
  codegen: IPluginCodegen;
  maxAttempts: number;
}

export interface AgentTurnRequest {
  /** 用户本轮输入（自然语言，可能是聊天也可能是插件需求） */
  text: string;
  /** 会话历史（仅用于聊天上下文，插件能力不依赖它） */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 试算输入，默认空数组 */
  sampleInput?: unknown;
  /** 当前会话 id，仅作为工件上的可选引用 */
  conversationRef?: string;
}

/** 把执行观测转成回喂文本，供 LLM 决定下一步 */
function observe(text: string): string {
  return `【插件系统观测】\n${text}\n请据此继续：若能完成就给出最终回复（action.kind=none），需要改代码就输出完整代码。`;
}

export class PluginAgentUseCase {
  constructor(private readonly options: PluginAgentOptions) {}

  async turn(req: AgentTurnRequest): Promise<AgentTurnResult> {
    const snapshot = await this.options.snapshot.snapshot();
    const system = this.options.prompts.agentSystemPrompt(snapshot, this.options.maxAttempts);
    const messages: ModelMessage[] = [
      { role: 'system', content: system },
      ...(req.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: req.text },
    ];

    let attempts = 0;
    let pendingObservation = '';

    // Agent Loop：最多 maxAttempts+1 次决策，防止模型反复要动作却不收敛
    const maxTurns = Math.max(1, this.options.maxAttempts) + 1;
    for (let turn = 0; turn < maxTurns; turn++) {
      const callMessages: ModelMessage[] = pendingObservation
        ? [...messages, { role: 'user', content: pendingObservation }]
        : messages;
      let raw: string;
      try {
        const result = await this.options.gateway.execute({
          task: 'chat.reply',
          messages: callMessages,
          options: { jsonMode: true },
        });
        raw = result.text;
      } catch (error) {
        return {
          reply: `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
          acted: false,
          attempts,
        };
      }

      const parsed = this.options.protocol.parse(raw);
      if (!parsed.ok) {
        // 协议失败：当作纯聊天回复，保证对话页永远可用
        return { reply: raw.trim().slice(0, 2000) || '模型没有返回内容', acted: false, attempts };
      }
      const { reply, action } = parsed.response;

      switch (action.kind) {
        case 'none':
          return { reply, acted: false, attempts };

        case 'plugin.list': {
          const lines = snapshot.length
            ? snapshot.map((p) => `- ${p.id} ${p.name} [${p.pointId}] ${p.enabled ? '启用' : '停用'} v${p.version}：${p.intent}`).join('\n')
            : '（当前没有插件）';
          pendingObservation = observe(`当前插件清单：\n${lines}`);
          continue;
        }

        case 'plugin.toggle': {
          const id = action.artifactId;
          if (!id) { pendingObservation = observe('toggle 缺少 artifactId'); continue; }
          const artifact = await this.options.artifacts.get(id);
          if (!artifact) { pendingObservation = observe(`找不到插件 ${id}`); continue; }
          await this.options.artifacts.setEnabled(id, !snapshot.find((p) => p.id === id)?.enabled);
          pendingObservation = observe(`插件 ${id} 状态已切换`);
          continue;
        }

        case 'plugin.delete': {
          const id = action.artifactId;
          if (!id) { pendingObservation = observe('delete 缺少 artifactId'); continue; }
          await this.options.artifacts.remove(id);
          pendingObservation = observe(`插件 ${id} 已删除`);
          continue;
        }

        case 'plugin.create':
        case 'plugin.revise': {
          attempts++;
          const isCreate = action.kind === 'plugin.create';
          const existing = action.artifactId
            ? await this.options.artifacts.get(action.artifactId)
            : null;
          const intent = action.intent ?? (isCreate ? req.text : existing?.intent ?? req.text);
          const spec = existing?.spec ?? RANKING_SPEC;
          const codegen = await this.options.codegen.run({
            intent,
            ...(existing?.code ? { currentCode: existing.code } : {}),
            ...(action.feedback ? { userFeedback: action.feedback } : {}),
            ...(action.code ? { userFeedback: action.code } : {}),
            sampleInput: req.sampleInput ?? [],
            spec,
            snapshot,
          });

          if (!codegen.ok) {
            pendingObservation = observe(
              `代码生成未通过（${codegen.attempts} 轮）：` +
              (codegen.lastFeedback?.error?.message ?? codegen.reply),
            );
            continue;
          }

          const check = this.options.validator.validate(codegen.code, spec);
          if (!check.ok) {
            pendingObservation = observe(`代码校验失败：${check.reason ?? '未知原因'}`);
            continue;
          }

          // 人工闸门：只创建/更新候选，默认不启用
          let artifactId: string;
          if (isCreate || !action.artifactId || !existing) {
            const created = await this.options.artifacts.create({
              name: action.name ?? '自定义排名规则',
              intent,
              code: codegen.code,
              pointId: spec.pointId,
              origin: 'llm',
              spec,
              ...(req.conversationRef ? { conversationRef: req.conversationRef } : {}),
            });
            artifactId = created.id;
          } else {
            await this.options.artifacts.revise(action.artifactId, {
              code: codegen.code,
              trigger: 'user-feedback',
              ...(action.feedback ? { feedback: action.feedback } : {}),
            });
            artifactId = action.artifactId;
          }

          return {
            reply: `${reply}\n\n✅ 已生成插件候选（${codegen.attempts} 轮，试算通过），需你确认后启用。`,
            ...(artifactId ? { artifactId } : {}),
            acted: true,
            attempts,
          };
        }

        default:
          return { reply, acted: false, attempts };
      }
    }

    return {
      reply: '本轮决策次数已用尽，请简化需求后重试。',
      acted: false,
      attempts,
    };
  }
}
