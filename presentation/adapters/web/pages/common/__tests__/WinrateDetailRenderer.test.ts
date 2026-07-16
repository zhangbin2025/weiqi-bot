/**
 * WinrateDetailRenderer 单元测试
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderWinrateDetail, formatWinrateContent } from '../WinrateDetailRenderer';
import type { WinrateStats } from '../WinrateDetailRenderer';
function createMockCard() {
  return {
    setContent: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
  };
}
describe('WinrateDetailRenderer', () => {
  describe('renderWinrateDetail', () => {
    it('应该渲染胜率详情', () => {
      const card = createMockCard();
      const stats: WinrateStats = { delta: 0.05, stddev: 0.02, samples: 100 };
      renderWinrateDetail(card, stats);
      expect(card.setContent).toHaveBeenCalled();
      expect(card.render).toHaveBeenCalled();
      const content = card.setContent.mock.calls[0][0] as string;
      expect(content).toContain('胜率详情');
      expect(content).toContain('+5.0%');
      expect(content).toContain('±2.0%');
      expect(content).toContain('100');
    });
    it('应该处理负胜率', () => {
      const card = createMockCard();
      const stats: WinrateStats = { delta: -0.03 };
      renderWinrateDetail(card, stats);
      const content = card.setContent.mock.calls[0][0] as string;
      expect(content).toContain('-3.0%');
    });
    it('应该处理零胜率', () => {
      const card = createMockCard();
      const stats: WinrateStats = { delta: 0 };
      renderWinrateDetail(card, stats);
      const content = card.setContent.mock.calls[0][0] as string;
      expect(content).toContain('0.0%');
    });
  });
  describe('formatWinrateContent', () => {
    it('应该格式化完整胜率内容', () => {
      const stats: WinrateStats = { delta: 0.05, stddev: 0.02, samples: 100 };
      const result = formatWinrateContent(stats);
      expect(result).toContain('+5.0%');
      expect(result).toContain('±2.0%');
      expect(result).toContain('100');
      expect(result).toContain('胜:');
      expect(result).toContain('负:');
    });
    it('应该处理无标准差和样本数', () => {
      const stats: WinrateStats = { delta: 0.03 };
      const result = formatWinrateContent(stats);
      expect(result).toContain('+3.0%');
      expect(result).not.toContain('标准差');
      expect(result).not.toContain('样本数');
    });
    it('应该处理极端正值胜率', () => {
      const stats: WinrateStats = { delta: 0.2 };
      const result = formatWinrateContent(stats);
      expect(result).toContain('+20.0%');
      expect(result).toContain('胜: 100%');
      expect(result).toContain('负: 0%');
    });
    it('应该处理极端负值胜率', () => {
      const stats: WinrateStats = { delta: -0.2 };
      const result = formatWinrateContent(stats);
      expect(result).toContain('-20.0%');
      expect(result).toContain('胜: 0%');
      expect(result).toContain('负: 100%');
    });
  });
});
