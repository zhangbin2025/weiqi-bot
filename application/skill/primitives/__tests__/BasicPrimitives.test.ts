/**
 * navigate_to 工具定义的「契约前移」回归测试。
 *
 * 2026-11-16 用户实测：自建「对弈」技能输入「下棋」后，模型回复里编出
 * https://example.com/play/index.html 这个外站网址。根因是「宿主注入链接、
 * 模型绝不写 URL」只写在 navigateToObservation（工具执行后才回喂），模型在
 * 决定 tool_calls 那一刻看不到。契约必须出现在工具定义本身。
 */
import { describe, it, expect } from 'vitest';
import { NAVIGATE_TO_TOOL, NAVIGATE_TO_TOOL_NAME } from '../BasicPrimitives';
import { navigateToObservation } from '../NavigateToPath';

describe('NAVIGATE_TO_TOOL 定义（调用前就能读到的契约）', () => {
  it('描述里明确「宿主注入链接、模型不写任何网址」，且点名编造域名是错的', () => {
    const d = NAVIGATE_TO_TOOL.description;
    expect(d).toContain('宿主');
    expect(d).toContain('绝不能在回复里写任何链接');
    expect(d).toContain('不要编造域名');
    // 不能再出现旧版那句「生成链接文本供回复里指路」的误导措辞
    expect(d).not.toContain('供回复里指路');
  });

  it('工具定义与执行后观察说的是同一条契约（不是两套口径）', () => {
    const obs = navigateToObservation('对弈', '/play/index.html');
    expect(NAVIGATE_TO_TOOL.description).toContain('只写一句简短引导语');
    expect(obs).toContain('不要写任何链接');
    expect(obs).toContain('停笔');
  });

  it('仍只接受站内绝对路径，query 键值限定字符串', () => {
    expect(NAVIGATE_TO_TOOL.name).toBe(NAVIGATE_TO_TOOL_NAME);
    expect(NAVIGATE_TO_TOOL.parameters.required).toEqual(['path', 'label']);
    const props = NAVIGATE_TO_TOOL.parameters.properties as Record<string, unknown>;
    expect((props['path'] as { description: string }).description).toContain('站内绝对路径');
  });
});
