import { describe, it, expect } from 'vitest';
import { isLLMCommand, redactCommand, handleLLMCommand } from '../LLMCommand';
import { loadPluginMaxAttempts, resetPluginMaxAttemptsForTest } from '../../plugin/PluginConfig';

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
    expect(shown.split('\n').length).toBeLessThanOrEqual(16);
  });

  it('命令以反引号包住（防 <baseUrl> 被 markdown 吞成 HTML），速查完整', async () => {
    let shown = '';
    await handleLLMCommand('/llm', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('`/llm <baseUrl> <apiKey> <model>`');
    for (const cmd of ['model', 'timeout', 'maxtokens', 'thinking', 'repairs', 'status', 'off']) {
      expect(shown).toContain('`/llm ' + cmd);
    }
  });
});

describe('/llm repairs（插件自动修复轮数可配置）', () => {
  it('无参数显示当前值', async () => {
    let shown = '';
    await handleLLMCommand('/llm repairs', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('当前插件自动修复轮数');
    expect(shown).toContain('/llm repairs');
  });

  it('合法值保存并提示', async () => {
    resetPluginMaxAttemptsForTest();
    let shown = '';
    await handleLLMCommand('/llm repairs 5', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('已改为 5');
    expect(loadPluginMaxAttempts()).toBe(5);
    resetPluginMaxAttemptsForTest();
  });

  it('越界收敛到 1~10', async () => {
    resetPluginMaxAttemptsForTest();
    await handleLLMCommand('/llm repairs 99', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(10);
    await handleLLMCommand('/llm repairs 1', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(1);
    // 0 / 负数由命令层直接拒绝，不覆盖已有值
    await handleLLMCommand('/llm repairs 0', { renderMessage: async () => {} });
    expect(loadPluginMaxAttempts()).toBe(1);
    await handleLLMCommand('/llm repairs 3', { renderMessage: async () => {} });
    resetPluginMaxAttemptsForTest();
  });

  it('非正数 / 非数字给出错误提示', async () => {
    let shown = '';
    await handleLLMCommand('/llm repairs abc', { renderMessage: async (c) => { shown = c; } });
    expect(shown).toContain('❌');
  });
});
