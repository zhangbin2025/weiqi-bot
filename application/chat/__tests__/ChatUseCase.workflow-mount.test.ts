/**
 * 「开发」角色写完 workflow 技能后，run_workflow 必须恒定挂在工具清单里。
 * 回归用户 17:24 反馈：路由未命中（用户没说触发词）+ system 写着「可传 debug:true」
 * 但工具清单没有入口 → 模型无法自己验收刚 skill_write 出来的配方。
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatUseCase } from '../ChatUseCase';
import type { ChatRoleId } from '../ChatRole';
import type { IModelGateway } from '../../model/IModelGateway';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import { createSkillRegistry } from '../../skill/SkillRegistry';
import type { SkillRecipe } from '../../skill/SkillTypes';
import { createBasicPrimitives } from '../../skill/primitives/BasicPrimitives';
import type { SkillDevKit } from '../../skill/dev/SkillDevTools';
import type { OperatorRegistry } from '../../plugin/OperatorRegistry';
import type { OperatorSpec } from '@domain/plugin/types';

const WF_SKILL: SkillRecipe = {
  schemaVersion: 1,
  id: 'user.demo.workflow',
  version: 3,
  name: '演示工作流',
  summary: '一步 echo 的调试用例',
  primitives: [],
  prompt: '展示说明，不进 model system',
  workflow: { steps: [{ id: 'only', call: 'echo', yield: true }] },
  inputs: [{ name: 'text', type: 'string', required: true }],
};

const webDeps = {
  proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
  fetchImpl: vi.fn() as unknown as typeof fetch,
};

function gateway() {
  return {
    isReady: vi.fn(() => true),
    execute: vi.fn().mockResolvedValue({ text: '好的', truncated: false }),
  } as unknown as IModelGateway & { execute: ReturnType<typeof vi.fn> };
}

function history() {
  const store: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  return {
    getMessages: vi.fn(() => store),
    getCurrentSession: vi.fn(() => ({ sessionId: 's1', messages: store })),
    addMessage: vi.fn(async (m: { role: 'user' | 'assistant'; content: string }) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatHistoryManager;
}

function renderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(),
    showTyping: vi.fn(),
    hideTyping: vi.fn(),
    showCountdownJump: vi.fn(),
    renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    beginPluginTrace: vi.fn().mockReturnValue(true),
    appendPluginTraceStep: vi.fn(),
    finishPluginTrace: vi.fn(),
  } as unknown as IMessageRenderer;
}

function devKit(): SkillDevKit {
  return {
    tools: [
      { name: 'skill_list', description: 'list', parameters: { type: 'object' } },
      { name: 'skill_write', description: 'write', parameters: { type: 'object' } },
    ],
    executors: {
      skill_list: async () => ({ observation: '空', ok: true, detail: 'list' }),
      skill_write: async () => ({ observation: '已保存', ok: true, detail: 'write' }),
    },
    systemSuffix: '【技能开发能力】测试片段',
  };
}

function operatorRegistry(): OperatorRegistry {
  // 空算子表即可：本组测试只验「工具是否挂载 + schema 是否列出配方」，
  // 不真跑 runner（跑起来由 16:36 的 debug 分支测试覆盖）。
  const specs = new Map<string, OperatorSpec>();
  return {
    specs,
    get: (name: string) => specs.get(name),
    run: async () => ({ value: null }),
  };
}

function make(
  roleId: ChatRoleId, gw: ReturnType<typeof gateway>,
  recipes: readonly SkillRecipe[] = [WF_SKILL],
) {
  const skills = {
    loadSkills: async () => recipes,
    primitives: createSkillRegistry(createBasicPrimitives(webDeps)),
    devKit: devKit(),
    // 关键：本轮路由**故意不命中**（用户没说触发词），模拟刚 skill_write 完的验收轮。
    routeSkills: async () => [],
  };
  return new ChatUseCase(
    gw, history(), renderer(), undefined, () => roleId, webDeps, skills,
    undefined, undefined, operatorRegistry(),
  );
}

function firstTools(gw: ReturnType<typeof gateway>): string[] {
  const req = gw.execute.mock.calls[0]![0] as { tools?: Array<{ name: string }> };
  return (req.tools ?? []).map((t) => t.name);
}

function firstSystem(gw: ReturnType<typeof gateway>): string {
  const req = gw.execute.mock.calls[0]![0] as {
    messages: Array<{ role: string; content: string }>;
  };
  return req.messages[0]!.content;
}

describe('run_workflow 挂载（开发角色验收刚写的 workflow 技能）', () => {
  it('dev 角色 + 路由未命中：run_workflow 仍挂载，且 skillId enum 含刚写的配方', async () => {
    const gw = gateway();
    await make('dev', gw).send('帮我验收一下这个技能');
    const names = firstTools(gw);
    expect(names).toContain('run_workflow');
    expect(names).toContain('skill_write');
    const wfTool = (gw.execute.mock.calls[0]![0] as {
      tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    }).tools!.find((t) => t.name === 'run_workflow');
    expect(wfTool).toBeDefined();
    const props = (wfTool!.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props['debug']).toBeDefined(); // dev 侧暴露调试开关
    const skillId = props['skillId'] as { enum?: string[] } | undefined;
    expect(skillId?.enum).toContain('user.demo.workflow');
    expect(wfTool!.description).toContain('user.demo.workflow');
    expect(firstSystem(gw)).toContain('【技能开发能力】测试片段');
  });

  it('dev 角色 + 零本地配方（新建会话）：run_workflow 仍恒定挂载', async () => {
    const gw = gateway();
    const h = make('dev', gw, []);
    await h.send('写一个百度热搜技能');

    expect(firstTools(gw)).toContain('run_workflow');
  });

  it('chat 角色 + 零本地配方：逐字不挂 run_workflow', async () => {
    const gw = gateway();
    const h = make('chat', gw, []);
    await h.send('随便聊聊');

    expect(firstTools(gw)).not.toContain('run_workflow');
  });

  it('chat 角色 + 路由未命中：逐字不挂 run_workflow（零额外 token）', async () => {
    const gw = gateway();
    await make('chat', gw).send('你好');
    expect(firstTools(gw)).not.toContain('run_workflow');
    expect(firstTools(gw)).not.toContain('skill_write');
  });
});
