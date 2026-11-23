/**
 * SkillRouter 单测：LLM 路由的目录构造、严格 id 校验、失败静默降级。
 * 不触网、不碰真实 gateway；用可注入的假网关断言调用形状。
 */

import { describe, it, expect, vi } from 'vitest';
import type { IModelGateway, ModelRequest, ModelResult } from '@application/model/IModelGateway';
import type { SkillRecipe } from '@application/skill/SkillTypes';
import { routeSkills, parseRouteReply } from '../SkillRouter';

function recipe(id: string, name: string, summary: string): SkillRecipe {
  return {
    schemaVersion: 1, id, version: 1, name, summary,
    primitives: ['web_fetch'], prompt: 'p',
  };
}

const RECIPES: SkillRecipe[] = [
  recipe('github.rest', 'GitHub REST API', '查仓库 / Issue / PR / 提交，直连 api.github.com'),
  recipe('weather.wttr', '天气查询', '查某地当前天气与预报'),
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
  const known = new Set(['github.rest', 'weather.wttr']);

  it('正常 JSON → 按给出顺序返回', () => {
    expect(parseRouteReply('{"skillIds":["github.rest"]}', known)).toEqual(['github.rest']);
    expect(parseRouteReply('{"skillIds":["weather.wttr","github.rest"]}', known))
      .toEqual(['weather.wttr', 'github.rest']);
  });

  it('空数组 / 空内容 / 脏 JSON 一律空', () => {
    expect(parseRouteReply('{"skillIds":[]}', known)).toEqual([]);
    expect(parseRouteReply('', known)).toEqual([]);
    expect(parseRouteReply('不是 JSON', known)).toEqual([]);
    expect(parseRouteReply('{"skillIds":"github.rest"}', known)).toEqual([]);
    expect(parseRouteReply('null', known)).toEqual([]);
    expect(parseRouteReply('[]', known)).toEqual([]);
    expect(parseRouteReply('{}', known)).toEqual([]);
  });

  it('幻觉 id / 非字符串 / 重复 → 丢弃或去重', () => {
    expect(parseRouteReply('{"skillIds":["ghost","github.rest"]}', known)).toEqual(['github.rest']);
    expect(parseRouteReply('{"skillIds":[42,null,{},"github.rest","github.rest"]}', known))
      .toEqual(['github.rest']);
  });

  it('容忍 markdown 代码块包裹（端点偶发）', () => {
    expect(parseRouteReply('```json\n{"skillIds":["github.rest"]}\n```', known))
      .toEqual(['github.rest']);
  });
});

describe('routeSkills', () => {
  const input = {
    recentUserTexts: ['查一下 weiqi-dev/weiqi-bot 的最后一个提交'],
    hasAttachments: false,
    previousSkillIds: [],
  };

  it('空目录 → 不发模型调用，直接返回空', async () => {
    const { gw, execute } = gatewayWith('{"skillIds":["github.rest"]}');
    const out = await routeSkills(gw, [], input);
    expect(out.skillIds).toEqual([]);
    expect(execute.mock.calls.length).toBe(0);
  });

  it('目录只用 id / name / summary，不塞 prompt；task=skill.route + jsonMode', async () => {
    const { gw, execute } = gatewayWith('{"skillIds":["github.rest"]}');
    const out = await routeSkills(gw, RECIPES, input);
    expect(out.skillIds).toEqual(['github.rest']);
    const req = execute.mock.calls[0]![0] as ModelRequest;
    expect(req.task).toBe('skill.route');
    expect(req.options?.jsonMode).toBe(true);
    expect(req.tools).toBeUndefined();
    const userText = req.messages.find((m) => m.role === 'user')!.content as string;
    expect(userText).toContain('github.rest | GitHub REST API | 查仓库');
    expect(userText).toContain('查一下 weiqi-dev/weiqi-bot 的最后一个提交');
    // prompt 是启用后才拼进对话 system 的指令，不该进路由目录
    expect(userText).not.toContain('使用提示');
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
