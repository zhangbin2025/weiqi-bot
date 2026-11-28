import { describe, it, expect } from 'vitest';
import { isLLMCommand, redactCommand, handleLLMCommand } from '../LLMCommand';
import { loadPluginMaxAttempts, resetPluginMaxAttemptsForTest } from '../../plugin/PluginConfig';
import {
  loadTokenRetentionDays, resetTokenRetentionDaysForTest,
} from '../../token/TokenUsageConfig';
import {
  loadWorkflowLimits, resetWorkflowLimitsForTest,
} from '../../skill/WorkflowConfig';

const workflowCommands = ['workflow-loop', 'workflow-total', 'workflow-depth'] as const;

describe('isLLMCommand', () => {
  it('匹配主命令，大小写不敏感', () => {
    expect(isLLMCommand('/llm https://x sk-abc')).toBe(true);
    expect(isLLMCommand('/LLM status')).toBe(true);
    expect(isLLMCommand('  /llm off  ')).toBe(true);
  });

  it('不匹配其它命令或自然语言', () => {
    expect(isLLMCommand('/help')).toBe(false);
    expect(isLLMCommand('/llm2 foo')).toBe(false);
    expect(isLLMCommand('帮我查柯洁')).toBe(false);
  });
});

describe('redactCommand', () => {
  it('配置命令里的 apiKey 被脱敏，URL 和模型保留', () => {
    const out = redactCommand('/llm https://API.Example.COM/V1 sk-AbCdEfGhIjKlMnOp MODEL-X');
    expect(out).toBe('/llm https://API.Example.COM/V1 sk-***MnOp MODEL-X');
    expect(out).not.toContain('sk-AbCdEfGhIjKlMnOp');
    // URL 大小写必须原样保留（不能被 toLowerCase 毁掉）
    expect(out).toContain('API.Example.COM');
  });

  it('无 model 参数时也可脱敏', () => {
    expect(redactCommand('/llm https://x.com/v1 sk-1234567890'))
      .toBe('/llm https://x.com/v1 sk-***7890');
  });

  it('status / off / model / timeout 子命令不脱敏', () => {
    expect(redactCommand('/llm status')).toBe('/llm status');
    expect(redactCommand('/llm off')).toBe('/llm off');
    expect(redactCommand('/llm model qwen-plus')).toBe('/llm model qwen-plus');
    expect(redactCommand('/llm timeout 90')).toBe('/llm timeout 90');
    expect(redactCommand('/LLM STATUS')).toBe('/LLM STATUS');
  });

  it('回归：子命令参数不能被当成 apiKey 打码', () => {
    // 曾因只排除 model，导致 /llm timeout 90 被显示成 /llm timeout ****
    expect(redactCommand('/llm timeout 90')).not.toContain('****');
    expect(redactCommand('/llm status')).not.toContain('****');
    expect(redactCommand('/llm off')).not.toContain('****');
    expect(redactCommand('/llm model gpt-4o-mini')).not.toContain('****');
    expect(redactCommand('/llm maxtokens 8192')).not.toContain('****');
    expect(redactCommand('/llm maxtokens 8192')).toBe('/llm maxtokens 8192');
    expect(redactCommand('/llm thinking off')).not.toContain('****');
    expect(redactCommand('/llm thinking off')).toBe('/llm thinking off');
    expect(redactCommand('/llm thinking on')).toBe('/llm thinking on');
    expect(redactCommand('/llm repairs 5')).toBe('/llm repairs 5');
    expect(redactCommand('/llm repairs 5')).not.toContain('****');
    for (const cmd of workflowCommands) {
      expect(redactCommand(`/llm ${cmd} 25`)).toBe(`/llm ${cmd} 25`);
      expect(redactCommand(`/llm ${cmd} off`)).not.toContain('****');
    }
  });

  it('maxtokens 用法文案不再让用户调 timeout', () => {
    // 回归：截断提示曾错误引导「用 /llm timeout 调大」，但 timeout 是请求秒数
    // 与 token 预算无关。文案必须指向 maxtokens。
    expect(/maxtokens/.test(
      'LLM 思考过程占满了 token 预算；请用 /llm maxtokens 8192 调大',
    )).toBe(true);
  });

  it('普通文本不受影响', () => {
    expect(redactCommand('帮我下载柯洁的棋谱')).toBe('帮我下载柯洁的棋谱');
  });
});


describe('/llm 帮助信息', () => {
  it('用 markdown 表格 + 列表展示，简洁不堆长说明', async () => {
    let shown = '';
    await handleLLMCommand('/llm', { renderMessage: async (c) => { shown = c; } });
    // 表格结构（表头 + 分隔行）
    expect(shown).toContain('| 命令 | 说明 |');
    expect(shown).toContain('|---|---|');
    // 列表结构
    expect(shown).toContain('- OpenAI 兼容端点');
    // 不再用代码块堆对齐、不再堆协议/预算/存储长说明
    expect(shown).not.toContain('```');
    expect(shown).not.toContain('Authorization: Bearer');
    expect(shown).not.toContain('localStorage');
    // 2026-11-28 新增三行 /llm workflow-* 预算命令（共 20 行），仍保持速查表精简
    expect(shown.split('\n').length).toBeLessThanOrEqual(20);
  });

  it('命令以反引号包住（防 <baseUrl> 被 markdown 吞成 HTML），速查完整', async () => {
    let shown = '';
    await handleLLMCommand('/llm', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('`/llm <baseUrl> <apiKey> <model>`');
    for (const cmd of ['model', 'timeout', 'maxtokens', 'thinking', 'repairs', 'retention', ...workflowCommands, 'status', 'off']) {
      expect(shown).toContain('`/llm ' + cmd);
    }
  });
});

describe('/llm repairs（插件自主决策次数可配置）', () => {
  it('无参数显示当前值，默认 10 次决策', async () => {
    resetPluginMaxAttemptsForTest();
    let shown = '';
    await handleLLMCommand('/llm repairs', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('当前插件自主决策次数 10');
    expect(shown).toContain('/llm repairs');
    resetPluginMaxAttemptsForTest();
  });

  it('合法值保存并提示', async () => {
    resetPluginMaxAttemptsForTest();
    let shown = '';
    await handleLLMCommand('/llm repairs 5', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('已改为 5');
    expect(loadPluginMaxAttempts()).toBe(4);
    resetPluginMaxAttemptsForTest();
  });

  it('越界收敛到 1~50', async () => {
    resetPluginMaxAttemptsForTest();
    await handleLLMCommand('/llm repairs 99', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(49);
    await handleLLMCommand('/llm repairs 1', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(0);
    // 0 / 负数由命令层直接拒绝，不覆盖已有值
    await handleLLMCommand('/llm repairs 0', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(0);
    await handleLLMCommand('/llm repairs 3', { renderMessage: async () => {} });
    await handleLLMCommand('/llm repairs 50', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(49);
    resetPluginMaxAttemptsForTest();
  });

  it('非正数 / 非数字给出错误提示', async () => {
    let shown = '';
    await handleLLMCommand('/llm repairs abc', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('❌');
  });
});

describe('/llm workflow-*（Workflow 资源预算，默认有限经验值）', () => {
  const cases = [
    { sub: 'workflow-loop', key: 'maxIterationsPerLoop' as const },
    { sub: 'workflow-total', key: 'maxTotalIterations' as const },
    { sub: 'workflow-depth', key: 'maxNestingDepth' as const },
  ];

  it('三个预算默认都是有限正整数，不是“不限制”', () => {
    resetWorkflowLimitsForTest();
    const limits = loadWorkflowLimits();
    for (const { key } of cases) {
      expect(Number.isSafeInteger(limits[key])).toBe(true);
      expect(limits[key]!).toBeGreaterThan(0);
    }
    resetWorkflowLimitsForTest();
  });

  it.each(cases)('$sub 支持正整数 / off，且无参查询显示经验值', async ({ sub, key }) => {
    resetWorkflowLimitsForTest();
    let shown = '';
    await handleLLMCommand(`/llm ${sub}`, { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('经验值');
    expect(shown).toContain('/llm ' + sub);

    await handleLLMCommand(`/llm ${sub} 250`, { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('已改为 250');
    expect(loadWorkflowLimits()[key]).toBe(250);

    await handleLLMCommand(`/llm ${sub} off`, { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('不限制');
    expect(loadWorkflowLimits()[key]).toBe(null);
    resetWorkflowLimitsForTest();
  });

  it.each(cases)('$sub 拒绝 0 / 负数 / 小数 / 非数字，不覆盖已有值', async ({ sub, key }) => {
    resetWorkflowLimitsForTest();
    await handleLLMCommand(`/llm ${sub} 37`, { renderMessage: async () => {} });
    expect(loadWorkflowLimits()[key]).toBe(37);
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      let shown = '';
      await handleLLMCommand(`/llm ${sub} ${bad}`, { renderMessage: async (c) => { shown = c; } });
      expect(shown).toContain('❌');
      expect(loadWorkflowLimits()[key]).toBe(37);
    }
    resetWorkflowLimitsForTest();
  });

  it('非法持久化值回退到默认经验值，而不是变成“不限制”', async () => {
    resetWorkflowLimitsForTest();
    // node 测试环境无 localStorage：仅覆盖命令层契约；parseLimit 的坏 storage 回退
    // 在 WorkflowConfig.test.ts 里通过注入 Storage 桩验证。
    let shown = '';
    await handleLLMCommand('/llm status', { renderMessage: async (c) => { shown = c; } });
    // 未配置 LLM 凭据时 status 走早退分支，不展示预算，不应误判为 off
    expect(shown).not.toContain('不限制');
    resetWorkflowLimitsForTest();
  });
});

describe('/llm retention（Token 统计保留天数）', () => {
  it('无参数显示当前值，缺省 30 天', async () => {
    resetTokenRetentionDaysForTest();
    let shown = '';
    await handleLLMCommand('/llm retention', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('当前 Token 统计保留 30 天');
    expect(shown).toContain('/llm retention');
  });

  it('合法值保存并提示', async () => {
    resetTokenRetentionDaysForTest();
    let shown = '';
    await handleLLMCommand('/llm retention 60', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('已改为 60');
    expect(loadTokenRetentionDays()).toBe(60);
    resetTokenRetentionDaysForTest();
  });

  it('越界收敛到 1~365', async () => {
    resetTokenRetentionDaysForTest();
    await handleLLMCommand('/llm retention 999', { renderMessage: async () => {} });
    expect(loadTokenRetentionDays()).toBe(365);
    await handleLLMCommand('/llm retention 1', { renderMessage: async () => {} });
    expect(loadTokenRetentionDays()).toBe(1);
    // 0 / 负数由命令层直接拒绝，不覆盖已有值
    await handleLLMCommand('/llm retention 0', { renderMessage: async () => {} });
    expect(loadTokenRetentionDays()).toBe(1);
    resetTokenRetentionDaysForTest();
  });

  it('非正数 / 非数字给出错误提示', async () => {
    let shown = '';
    await handleLLMCommand('/llm retention abc', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('❌');
  });

  it('redactCommand 不把 retention 参数当 apiKey 打码', () => {
    expect(redactCommand('/llm retention 90')).toBe('/llm retention 90');
  });
});
