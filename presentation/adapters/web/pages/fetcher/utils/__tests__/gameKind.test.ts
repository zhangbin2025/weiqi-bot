/**
 * 棋谱分类器测试
 * @module presentation/pages/fetcher/utils/__tests__/gameKind
 */
import { describe, it, expect } from 'vitest';
import {
  classifyGame,
  isPuzzleGame,
  isLiveGame,
  hasAiAnnotation,
  actionLabel,
  type ClassifyInput,
} from '../gameKind';

describe('棋谱分类器', () => {
  describe('死活题（puzzle）', () => {
    const cases: Array<[string, string, string]> = [
      ['lib-life-death', 'lib://life-and-death/2026-10-12/0', '内置题库'],
      ['goproblems', 'https://goproblems.com/1', 'GoProblems'],
      ['ogs-puzzle', 'https://online-go.com/puzzle/1', 'OGS死活题'],
      ['weiqi101', 'https://www.101weiqi.com/qday/123', '101每日题'],
      ['weiqi101', 'https://www.101weiqi.com/q/456', '101题库'],
    ];

    it.each(cases)('%s（%s）判定为死活题，做题优先', (source, url) => {
      const cls = classifyGame({ source, url });
      expect(cls.kind).toBe('puzzle');
      expect(cls.primary).toBe('puzzle');
      expect(cls.actions).toContain('puzzle');
      expect(cls.actions).toContain('review');
    });

    it('非题目页的 101 链接不算死活题', () => {
      expect(isPuzzleGame('weiqi101', 'https://www.101weiqi.com/other/1')).toBe(false);
    });
  });

  describe('未结束实战（live）', () => {
    it('isLive=true 判定为直播，直播优先', () => {
      const cls = classifyGame({ source: 'ogs-live', url: 'https://online-go.com/game/1', isLive: true });
      expect(cls.kind).toBe('live');
      expect(cls.primary).toBe('live');
      expect(cls.actions).toContain('joseki');
    });

    it('isEnded=false 判定为直播', () => {
      expect(classifyGame({ source: 'foxwq', isEnded: false }).kind).toBe('live');
    });

    it('isEnded=true 即使来源是 ogs-live 也不算直播', () => {
      const cls = classifyGame({ source: 'ogs-live', isEnded: true, isLive: false });
      expect(cls.kind).not.toBe('live');
    });

    it('无实况标记时按来源回退（yike-live）', () => {
      expect(classifyGame({ source: 'yike-live' }).kind).toBe('live');
    });
  });

  describe('带 AI 标注（ai-review）', () => {
    it('lib-ai-review 来源直接判定（无需 SGF）', () => {
      const cls = classifyGame({ source: 'lib-ai-review' });
      expect(cls.kind).toBe('ai-review');
      expect(cls.primary).toBe('decision');
      expect(cls.actions).toContain('decision');
      expect(cls.actions).toContain('review');
      expect(cls.actions).toContain('joseki');
    });

    it('野狐绝艺注释识别为 AI 标注', () => {
      const sgf = '(;SZ[19];B[pd]C[jueyi黑53.2%];W[dd])';
      expect(hasAiAnnotation(sgf)).toBe(true);
      expect(classifyGame({ source: 'foxwq', sgf }).kind).toBe('ai-review');
    });

    it('OGS 胜率注释识别为 AI 标注', () => {
      const sgf = '(;SZ[19];B[pd]C[胜率: 36.1% | 目差: -0.9 | 第1手])';
      expect(hasAiAnnotation(sgf)).toBe(true);
    });

    it('OGS 头部 AI 元信息识别为 AI 标注', () => {
      const sgf = '(;SZ[19]C[AI: KataGo | Network: abc... | Final WR: 51.2%];B[pd])';
      expect(hasAiAnnotation(sgf)).toBe(true);
    });

    it('KataGo Archive 注释识别为 AI 标注', () => {
      const sgf = '(;SZ[19];B[pd]C[0.51 0.49 0.00 0.6 v=600])';
      expect(hasAiAnnotation(sgf)).toBe(true);
    });

    it('无注释的普通棋谱不识别为 AI 标注', () => {
      expect(hasAiAnnotation('(;SZ[19];B[pd];W[dd])')).toBe(false);
    });
  });

  describe('一般棋谱（plain）', () => {
    it('无实况、无 AI 标注：打谱优先', () => {
      const cls = classifyGame({ source: 'foxwq', sgf: '(;SZ[19];B[pd];W[dd])' });
      expect(cls.kind).toBe('plain');
      expect(cls.primary).toBe('view');
      expect(cls.actions).toContain('review');
      expect(cls.actions).toContain('joseki');
      expect(cls.actions).not.toContain('decision');
      expect(cls.actions).not.toContain('puzzle');
      expect(cls.actions).not.toContain('live');
    });
  });

  describe('短路优先级', () => {
    it('死活题优先于直播标记', () => {
      const cls = classifyGame({ source: 'goproblems', isLive: true });
      expect(cls.kind).toBe('puzzle');
    });

    it('直播优先于 AI 标注', () => {
      const cls = classifyGame({ source: 'lib-ai-review', isLive: true });
      expect(cls.kind).toBe('live');
    });

    it('所有类别都含下载与分享', () => {
      const inputs: ClassifyInput[] = [
        { source: 'lib-life-death' },
        { source: 'ogs-live', isLive: true },
        { source: 'lib-ai-review' },
        { source: 'foxwq' },
      ];
      for (const i of inputs) {
        const cls = classifyGame(i);
        expect(cls.actions).toContain('download');
        expect(cls.actions).toContain('share');
      }
    });
  });

  describe('动作文案', () => {
    it('每个动作都有图标与文案', () => {
      expect(actionLabel('puzzle')).toBe('🧩 做题');
      expect(actionLabel('live')).toBe('🔴 直播');
      expect(actionLabel('decision')).toBe('🎯 实战选点');
      expect(actionLabel('joseki')).toBe('📐 发现定式');
      expect(actionLabel('view')).toBe('👁️ 查看');
      expect(actionLabel('review')).toBe('🔍 复盘');
    });
  });
});
