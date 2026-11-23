/**
 * SkillRouter 单测：LLM 路由的目录构造、严格 id 校验、失败静默降级。
 * 不触网、不碰真实 gateway；用可注入的假网关断言调用形状。
 */

import { describe, it, expect, vi } from 'vitest';
import type { IModelGateway, ModelRequest, ModelResult } from '@application/model/IModelGateway';
import type { SkillRecipe } from '@application/skill/SkillTypes';
import { routeSkills, parseRouteReply } from '../SkillRouter';

function recipe(
  id: string, name: string, summary: string, routeHint?: string[],
): SkillRecipe {
  return {
    schemaVersion: 1, id, version: 1, name, summary,
    ...(routeHint !== undefined ? { routeHint } : {}),
    primitives: ['web_fetch'], prompt: '启用后执行的内部指令 PROMPT_DETAIL',
  };
}

const RECIPES: SkillRecipe[] = [
  recipe(
    'demo.a', '示例技能 A',
    '执行说明细节：用某个原语取回一份结构化数据并渲染（含内部参数与凭据规格）',
    ['用户说「查一下…」时', '用户想核对一份清单时'],
  ),
  recipe(
    'demo.b', '示例技能 B',
    '执行说明细节：按需求选择参数并输出精简结果（含内部端点与默认值）',
    ['用户说「帮我整理…」时'],
  ),
];

function gatewayWith(reply: string | (() => Promise<ModelResult>)): {
  gw: IModelGateway;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async (_req: ModelRequest): Promise<ModelResult> =>
    typeof reply === 'function' ? reply() : ({ text: reply, truncated: false }));
  return { gw: { isReady: () => true, execute } as unknown as IModelGateway, execute };
}

describe('parseRouteReply（严格只认目录内 id）', () => {
  const known = new Set(['demo.a', 'demo.b']);

  it('正常 JSON → 按给出顺序返回', () => {
    expect(parseRouteReply('{"skillIds":["demo.a"]}', known)).toEqual(['demo.a']);
    expect(parseRouteReply('{"skillIds":["demo.b","demo.a"]}', known))
      .toEqual(['demo.b', 'demo.a']);
  });

  it('空数组 / 空内容 / 脏 JSON 一律空', () => {
    expect(parseRouteReply('{"skillIds":[]}', known)).toEqual([]);
    expect(parseRouteReply('', known)).toEqual([]);
    expect(parseRouteReply('不是 JSON', known)).toEqual([]);
    expect(parseRouteReply('{"skillIds":"demo.a"}', known)).toEqual([]);
    expect(parseRouteReply('null', known)).toEqual([]);
    expect(parseRouteReply('[]', known)).toEqual([]);
    expect(parseRouteReply('{}', known)).toEqual([]);
  });

  it('幻觉 id / 非字符串 / 重复 → 丢弃或去重', () => {
    expect(parseRouteReply('{"skillIds":["ghost","demo.a"]}', known)).toEqual(['demo.a']);
    expect(parseRouteReply('{"skillIds":[42,null,{},"demo.a","demo.a"]}', known))
      .toEqual(['demo.a']);
  });

  it('容忍 markdown 代码块包裹（端点偶发）', () => {
    expect(parseRouteReply('```json\n{"skillIds":["demo.a"]}\n```', known))
      .toEqual(['demo.a']);
  });
});

describe('routeSkills', () => {
  const input = {
    recentUserTexts: ['帮我核对一下这份清单'],
    hasAttachments: false,
    previousSkillIds: [],
  };

  it('空目录 → 不发模型调用，直接返回空', async () => {
    const { gw, execute } = gatewayWith('{"skillIds":["demo.a"]}');
    const out = await routeSkills(gw, [], input);
    expect(out.skillIds).toEqual([]);
    expect(execute.mock.calls.length).toBe(0);
  });

  it('配了路由词 → 目录行含 join(\'、\') 的那一段；不塞 summary 执行细节 / prompt；task=skill.route + jsonMode', async () => {
    const { gw, execute } = gatewayWith('{"skillIds":["demo.a"]}');
    const out = await routeSkills(gw, RECIPES, input);
    expect(out.skillIds).toEqual(['demo.a']);
    const req = execute.mock.calls[0]![0] as ModelRequest;
    expect(req.task).toBe('skill.route');
    expect(req.options?.jsonMode).toBe(true);
    expect(req.tools).toBeUndefined();
    const userText = req.messages.find((m) => m.role === 'user')!.content as string;
    // 多路由词用顿号拼成一行，保持「目录一技能一行」
    expect(userText).toContain(
      '- demo.a | 示例技能 A | 用户说「查一下…」时、用户想核对一份清单时',
    );
    expect(userText).toContain('- demo.b | 示例技能 B | 用户说「帮我整理…」时');
    expect(userText).toContain('帮我核对一下这份清单');
    // summary / prompt 的执行细节（散文命中后由 buildSkillSystemPrompt 注入），不该进路由目录
    expect(userText).not.toContain('用某个原语取回一份结构化数据并渲染');
    expect(userText).not.toContain('含内部参数与凭据规格');
    expect(userText).not.toContain('含内部端点与默认值');
    // 夹具 prompt 是固定可辨识串，不该进路由目录
    expect(userText).not.toContain('PROMPT_DETAIL');
  });

  it('没配路由词 → 目录行严格只有 id | name（不回落 summary、不出现第三段）', async () => {
    const plain: SkillRecipe[] = [
      recipe('demo.c', '示例技能 C', '执行说明：某条不该进目录的内部细节'),
    ];
    const { gw, execute } = gatewayWith('{"skillIds":["demo.c"]}');
    await routeSkills(gw, plain, input);
    const userText = (execute.mock.calls[0]![0] as ModelRequest).messages
      .find((m) => m.role === 'user')!.content as string;
    const line = userText.split('\n').find((l) => l.startsWith('- demo.c |'))!;
    expect(line).toBe('- demo.c | 示例技能 C');
    expect(line).not.toContain(' | 示例技能 C |'); // 无第三段
    expect(userText).not.toContain('执行说明：某条不该进目录的内部细节'); // summary 不回落
    expect(userText).not.toContain('某条不该进目录的内部细节');
  });

  it('路由词覆盖 name 回答不了的自然说法，且规则 4 不含具体能力词', async () => {
    const withHint: SkillRecipe[] = [
      recipe(
        'demo.d', '示例技能 D', '（执行说明：某项不该进目录的内部细节）',
        ['用户说「查一下…」时', '用户想核对一份清单时'],
      ),
    ];
    const { gw, execute } = gatewayWith('{"skillIds":["demo.d"]}');
    await routeSkills(gw, withHint, {
      recentUserTexts: ['查一下这个'], hasAttachments: true, previousSkillIds: [],
    });
    const req = execute.mock.calls[0]![0] as ModelRequest;
    const userText = req.messages.find((m) => m.role === 'user')!.content as string;
    const systemText = req.messages.find((m) => m.role === 'system')!.content as string;
    // 断言完整目录行：路由词确实进了目录，不靠「用户消息里恰好有这个词」蒙混过关
    expect(userText).toContain(
      '- demo.d | 示例技能 D | 用户说「查一下…」时、用户想核对一份清单时',
    );
    // 执行说明仍在配方里（散文命中后注入），但目录里不靠它触发
    expect(userText).not.toContain('某项不该进目录的内部细节');
    // 规则 4 只讲结构，不枚举具体能力词
    expect(systemText).toContain('上下文有图片附件时');
    for (const word of ['图片 / 拍照', '棋谱识别', '拍照', '摆子', '记谱']) {
      expect(systemText).not.toContain(word);
    }
    // 路由规则统一用「名称与路由词（若目录提供）」措辞，保留「不要猜测目录外的能力」
    expect(systemText).toContain('名称与路由词（若目录提供）');
    expect(systemText).toContain('不要猜测目录外的能力');
  });

  it('上下文信号写明有附件 / 上一轮技能，供承接语判断', async () => {
    const { gw, execute } = gatewayWith('{"skillIds":[]}');
    await routeSkills(gw, RECIPES, {
      recentUserTexts: ['好的，确认'],
      hasAttachments: true,
      previousSkillIds: ['user.demo'],
    });
    const userText = (execute.mock.calls[0]![0] as ModelRequest).messages
      .find((m) => m.role === 'user')!.content as string;
    expect(userText).toContain('有图片附件：是');
    expect(userText).toContain('上一轮技能：user.demo');
  });

  it('模型返回目录外 id → 过滤为空', async () => {
    const { gw } = gatewayWith('{"skillIds":["ghost.skill"]}');
    expect((await routeSkills(gw, RECIPES, input)).skillIds).toEqual([]);
  });

  it('网关抛错 / 返回空内容 → 静默降级为空 + reason，不抛给上层', async () => {
    const { gw } = gatewayWith(() => Promise.reject(new Error('网络挂了')));
    const failed = await routeSkills(gw, RECIPES, input);
    expect(failed.skillIds).toEqual([]);
    expect(failed.reason).toContain('网络挂了');

    const { gw: emptyGw } = gatewayWith('');
    const empty = await routeSkills(emptyGw, RECIPES, input);
    expect(empty.skillIds).toEqual([]);
    expect(empty.reason).toContain('路由返回空内容');
  });
});
