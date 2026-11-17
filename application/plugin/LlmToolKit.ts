/**
 * 模型能力插件工具集（llm-tool 扩展点）
 * @module application/plugin/LlmToolKit
 *
 * 与技能配方「system 给声明 + 宿主内置执行器」同构，和排名插件共用同一套
 * 工件存储 / QuickJS 沙箱 / 版本历史 / 人工启用闸门。差别只在契约：
 *   ranking  → rank({matches}) → {columns,rows}，走赛事页排名管线
 *   llm-tool → call({method,args}) → 任意可 JSON 序列化的值，走对话页工具表
 *
 * 安全边界（不因「给模型加能力」而放开任何一条）：
 * - 只读「已启用」且 pointId === 'llm-tool' 的工件；装完默认停用，人工启用才可见。
 * - 库源码永远不进主线程 JS 环境，也不进模型上下文：模型只看 system 里的库名 +
 *   方法说明，调用时只提交 {libId, method, args}。
 * - method 必须命中资源声明的 exposes[] 白名单；args 只作为 JSON 数据进入
 *   QuickJsExecutor 的 __PLUGIN_INPUT__，绝不参与代码拼接（胶水由宿主固定生成）。
 * - 每次调用新建一次性 Worker（runtime.run 既有语义），崩溃隔离 + 硬超时沿用
 *   DEFAULT_PLUGIN_LIMITS；缓存命中即零网络下载，字节已在本地工件里。
 *
 * 数值口径：不引入任何新阈值 / 经验常数。配额一律来自 LLM_TOOL_SPEC.limits，
 * 观察文本裁剪由 ToolLoop 按 CONTEXT_LIMITS.maxCharsPerMessage 统一处理。
 *
 * 决策预算口径（2026-11-17）：能力库调用是「只读准备动作」，成功返回置
 * `preparatory: true`，与 web_cache_read 同口径，不推进 ToolLoop 的 decisions。
 * 依据：llm-tool 沙箱 hostApi:[]、零网络、不读运行时时钟，方法输出只由
 * {method,args} 与工件源码决定，是确定性纯函数；一个意图摊成多步只读查询
 * 不该被 maxTurns(=4) 掐断（实测月历配方连续 4 次 toLunar 就耗尽预算）。
 * **失败一律不豁免**：ok:false 仍计一次实质决策，让依赖缺失/参数错误尽快
 * 收敛到最终回复，避免模型反复重试把 maxModelCalls guard 耗光。
 *
 * ⚠️ ToolLoop 的 systemPrompt 是「替换制」：本模块只产出能力库清单片段，
 * 由 ChatUseCase.buildChatToolKit 追加到已拼好的 system 尾部，避免冲掉闲聊 /
 * 技能 / 技能开发的 system 说明。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import type { ToolExecutor, ToolKit, ToolOutcome } from '../chat/ToolLoop';
import {
  LLM_TOOL_POINT_ID, LLM_TOOL_SPEC,
  type IPluginRuntime, type PluginArtifact, type PluginRunResult,
} from '@domain/plugin/types';
import type { PluginArtifactService } from './PluginArtifactService';
import type { LlmToolExposure, LlmToolSmokeCase } from '@services/plugin-catalog/PluginCatalogTypes';

export const LLM_TOOL_CALL_NAME = 'llm_tool_call';

/** 工件里携带的 llm-tool 契约（安装时从 plugin.json 透传，随工件持久化） */
export interface LlmToolContract {
  exposes: LlmToolExposure[];
  smoke: LlmToolSmokeCase[];
}

export interface LlmToolKitDeps {
  artifacts: PluginArtifactService;
  runtime: IPluginRuntime;
  /** 按工件取资源契约；默认从 artifact.llmTool 读，注入便于测试替换 */
  contractOf?: (artifact: PluginArtifact) => LlmToolContract | undefined;
}

/**
 * 契约随工件持久化：安装时把 plugin.json 的 exposes[]/smoke[] 一起写进 artifact，
 * 之后即使源不可达、缓存清空，模型侧工具声明仍可重建。字段是可选的，
 * 老 ranking 工件不带它，读取时按空处理。
 */
export function readLlmToolContract(artifact: PluginArtifact): LlmToolContract | undefined {
  const raw = artifact.llmTool;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw.exposes) || raw.exposes.length === 0) return undefined;
  return { exposes: raw.exposes, smoke: Array.isArray(raw.smoke) ? raw.smoke : [] };
}

const CALL_TOOL: ModelToolDefinition = {
  name: LLM_TOOL_CALL_NAME,
  description:
    '调用一个已启用的本地 JS 能力库（llm-tool 插件）。system 里的「可用能力库」列出'
    + ' libId、方法名与参数；只传那里列出的方法。库源码已经在本机，调用不联网。'
    + '返回的是库方法原样的 JSON 结果，不要编造。',
  parameters: {
    type: 'object',
    properties: {
      libId: { type: 'string', description: '可用能力库里的 libId（插件工件 id）' },
      method: { type: 'string', description: '该库 exposes[] 里声明的方法名' },
      args: {
        type: 'array',
        description: '传给方法的参数（数组，通常是一个对象）',
        items: {},
      },
    },
    required: ['libId', 'method', 'args'],
    additionalProperties: false,
  },
};

interface ActiveLib {
  artifact: PluginArtifact;
  contract: LlmToolContract;
}

/**
 * 建一套 llm-tool 工具集。
 * - `tools` 恒为 [llm_tool_call]：即使当前没有已启用库，也让模型知道有这个工具，
 *   调用时执行器会明确回「无可用能力库」；清单由 system 片段动态给出。
 * - `systemPrompt` 返回**片段**（不是整段 system），无已启用库时是空串。
 *   ChatUseCase 把它追加到已拼好的 system 尾部。
 */
export function createLlmToolKit(deps: LlmToolKitDeps): ToolKit & {
  buildSystemSuffix: () => Promise<string>;
  /** 当前已启用能力库暴露的方法名并集；供技能 requiredCapabilities 激活前判定 */
  listCapabilities: () => Promise<string[]>;
} {
  const contractOf = deps.contractOf ?? readLlmToolContract;

  const listActive = async (): Promise<ActiveLib[]> => {
    let all: PluginArtifact[];
    try {
      all = await deps.artifacts.list();
    } catch {
      return [];
    }
    const out: ActiveLib[] = [];
    for (const a of all) {
      if (!a.enabled || a.pointId !== LLM_TOOL_POINT_ID) continue;
      const contract = contractOf(a);
      if (contract !== undefined) out.push({ artifact: a, contract });
    }
    return out;
  };

  const executor: ToolExecutor = async (argsJson: string): Promise<ToolOutcome> => {
    let input: { libId?: unknown; method?: unknown; args?: unknown };
    try {
      input = JSON.parse(argsJson) as typeof input;
    } catch (e) {
      return fail(`llm_tool_call 参数不是合法 JSON：${messageOf(e)}`, '参数解析失败');
    }
    const libId = typeof input.libId === 'string' ? input.libId : '';
    const method = typeof input.method === 'string' ? input.method : '';
    const args = Array.isArray(input.args) ? input.args : [];
    if (!libId || !method) {
      return fail('llm_tool_call 需要 libId 与 method', '缺少必要参数');
    }

    const active = await listActive();
    if (active.length === 0) {
      return fail('当前没有已启用的 llm-tool 能力库。请到「插件」面板安装并启用后再调用。', '无已启用能力库');
    }
    const picked = active.find((x) => x.artifact.id === libId);
    if (picked === undefined) {
      return fail(
        `libId ${libId} 不是已启用的 llm-tool 能力库，请只使用「可用能力库」里列出的 id`,
        '能力库不可用',
      );
    }
    const exposure = picked.contract.exposes.find((e) => e.name === method);
    if (exposure === undefined) {
      return fail(
        `方法 ${method} 不在 ${picked.artifact.name} 的 exposes[] 白名单里。可用方法：`
        + picked.contract.exposes.map((e) => e.name).join('、'),
        '方法不在白名单',
      );
    }

    let result: PluginRunResult;
    try {
      // 宿主固定胶水：库源码 + call 入口是工件自带的完整源码，method/args 只作为
      // JSON 数据进 __PLUGIN_INPUT__，不拼进代码字符串。runtime 每次新建 Worker。
      result = await deps.runtime.run(
        picked.artifact.code,
        { method, args },
        picked.artifact.spec ?? LLM_TOOL_SPEC,
      );
    } catch (e) {
      return fail(`能力库执行异常：${messageOf(e)}`, '沙箱异常');
    }
    if (!result.ok) {
      return fail(
        `能力库执行失败（${result.phase}）：${result.error?.message ?? '未知错误'}`,
        `执行失败：${result.phase}`,
      );
    }
    let observation: string;
    try {
      observation = JSON.stringify(result.output);
    } catch (e) {
      return fail(`能力库结果无法序列化：${messageOf(e)}`, '结果不可序列化');
    }
    return {
      observation,
      ok: true,
      detail: `调用 ${picked.artifact.name}.${method}`,
      // 只读确定性计算：同一次自主决策内的准备动作，不占决策轮数预算。
      // fail() 路径刻意不置位，失败要让用户尽快看到明确提示。
      preparatory: true,
    };
  };

  const buildSystemSuffix = async (): Promise<string> => {
    const active = await listActive();
    if (active.length === 0) return '';
    const lines: string[] = ['【可用能力库（llm-tool 插件，已人工启用）】'];
    for (const { artifact, contract } of active) {
      lines.push(`- libId: ${artifact.id} ｜ ${artifact.name}`);
      for (const e of contract.exposes) {
        lines.push(`  · ${e.name}：${e.description}`);
        lines.push(`    参数：${JSON.stringify(e.params)}`);
      }
    }
    lines.push(
      `调用方式：${LLM_TOOL_CALL_NAME}({libId, method, args})；args 是数组，通常为 [参数对象]。`,
      '源码不在上下文里，也不要复述 URL；结果以工具返回为准。',
    );
    return lines.join('\n');
  };

  return {
    tools: [CALL_TOOL],
    executors: { [LLM_TOOL_CALL_NAME]: executor },
    buildSystemSuffix,
    listCapabilities: async (): Promise<string[]> => {
      const active = await listActive();
      // 用 Set 去重：多个库暴露同名方法时只算一次，判定只关心「有没有」。
      const names = new Set<string>();
      for (const { contract } of active) {
        for (const e of contract.exposes) names.add(e.name);
      }
      return [...names];
    },
  };
}

function fail(observation: string, detail: string): ToolOutcome {
  return { observation, ok: false, detail };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
