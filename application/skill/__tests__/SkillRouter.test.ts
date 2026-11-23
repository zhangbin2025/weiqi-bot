/**
 * SkillRouter 单测：LLM 路由的目录构造、严格 id 校验、失败静默降级。
 * 不触网、不碰真实 gateway；用可注入的假网关断言调用形状。
 */

import { describe, it, expect, vi } from 'vitest';
import type { IModelGateway, ModelRequest, ModelResult } from '@application/model/IModelGateway';
import type { SkillRecipe } from '@application/skill/SkillTypes';
import { routeSkills, parseRouteReply } from '../SkillRouter';

function recipe(id: string, name: string, summary: string, routeHint?: string): SkillRecipe {
  return {
    schemaVersion: 1, id, version: 1, name, summary,
    ...(routeHint !== undefined ? { routeHint } : {}),
    primitives: ['web_fetch'], prompt: 'p',
  };
}

const RECIPES: SkillRecipe[] = [
  recipe(
    'github.rest', 'GitHub REST API',
    '用通用 http_fetch_auth 原语直连 api.github.com 查仓库 / Issue / PR，Token 规格由 secrets 声明',
    '用户想查 GitHub 仓库、Issue、Pull Request、最后一个提交、用户信息时',
  ),
  recipe(
    'weather.wttr', '天气查询',
    '按需求选择 wttr.in 请求参数，默认当天精简 JSON，支持自选城市',
    '用户想查某地天气 / 预报、或管理自选城市时',
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

  it('目录 = id | name | 一行触发条件，不塞 summary 执行细节 / prompt；task=skill.route + jsonMode', async () => {
    const { gw, execute } = gatewayWith('{"skillIds":["github.rest"]}');
    const out = await routeSkills(gw, RECIPES, input);
    expect(out.skillIds).toEqual(['github.rest']);
    const req = execute.mock.calls[0]![0] as ModelRequest;
    expect(req.task).toBe('skill.route');
    expect(req.options?.jsonMode).toBe(true);
    expect(req.tools).toBeUndefined();
    const userText = req.messages.find((m) => m.role === 'user')!.content as string;
    // 触发条件（一行）在目录里：name 回答不了的「最后一个提交」靠它命中
    expect(userText).toContain('- github.rest | GitHub REST API | 用户想查 GitHub 仓库、Issue、Pull Request、最后一个提交、用户信息时');
    expect(userText).toContain('- weather.wttr | 天气查询 | 用户想查某地天气 / 预报、或管理自选城市时');
    expect(userText).toContain('查一下 weiqi-dev/weiqi-bot 的最后一个提交');
    // summary 的执行细节（散文命中后由 buildSkillSystemPrompt 注入），不该进路由目录
    expect(userText).not.toContain('http_fetch_auth');
    expect(userText).not.toContain('wttr.in');
    expect(userText).not.toContain('Token 规格由 secrets');
    // prompt 是启用后才拼进对话 system 的指令，不该进路由目录
    expect(userText).not.toContain('使用提示');
  });

  it('未标注 routeHint 的配方 / 自建技能：目录回落到 summary，不会瞎路由', async () => {
    const plain: SkillRecipe[] = [
      recipe('recorder.open', '记谱', '记录棋谱、摆子出题、拍照摆子、拍照还原棋局'),
    ];
    const { gw, execute } = gatewayWith('{"skillIds":["recorder.open"]}');
    await routeSkills(gw, plain, input);
    const userText = (execute.mock.calls[0]![0] as ModelRequest).messages
      .find((m) => m.role === 'user')!.content as string;
    expect(userText).toContain('- recorder.open | 记谱 | 记录棋谱、摆子出题、拍照摆子、拍照还原棋局');
  });

  it('触发条件覆盖 name 回答不了的自然说法（拍照摆子 → 记谱），修复第四步回归', async () => {
    // 逐字取自 assets recorder.open 配方 prompt 的「常见说法」，有出处、不是造词表
    const withHint: SkillRecipe[] = [
      recipe(
        'recorder.open', '记谱', '（执行说明：导航到记谱页面的各种模式）',
        '用户想记录棋谱、摆子出题、拍照摆子、拍照还原棋局、把照片里的棋盘摆成电子棋谱时',
      ),
    ];
    const { gw, execute } = gatewayWith('{"skillIds":["recorder.open"]}');
    await routeSkills(gw, withHint, {
      recentUserTexts: ['拍照摆子'], hasAttachments: true, previousSkillIds: [],
    });
    const userText = (execute.mock.calls[0]![0] as ModelRequest).messages
      .find((m) => m.role === 'user')!.content as string;
    // 断言完整目录行：触发线索确实进了目录，不靠「用户消息里恰好有这个词」蒙混过关
    expect(userText).toContain(
      '- recorder.open | 记谱 | 用户想记录棋谱、摆子出题、拍照摆子、拍照还原棋局、把照片里的棋盘摆成电子棋谱时',
    );
    // 执行说明仍在配方里（散文命中后注入），但目录里不靠它触发
    expect(userText).not.toContain('导航到记谱页面的各种模式');
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
