import { describe, it, expect } from 'vitest';
import { isLLMCommand, redactCommand } from '../LLMCommand';

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
  });

  it('普通文本不受影响', () => {
    expect(redactCommand('帮我下载柯洁的棋谱')).toBe('帮我下载柯洁的棋谱');
  });
});
