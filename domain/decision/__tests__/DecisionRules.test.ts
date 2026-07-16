import { describe, it, expect } from 'vitest';
import {
  isBlunder,
  classifyBadMove,
  calcDifficulty,
  classifyPhase,
  parseRank,
  determineGameLevel,
  generateProblemId,
} from '../DecisionRules.js';

describe('DecisionRules', () => {
  describe('isBlunder', () => {
    it('差值>10为恶手', () => {
      expect(isBlunder(50, 65)).toBe(true);
    });
    it('差值<10不为恶手', () => {
      expect(isBlunder(56, 65)).toBe(false);
    });
    it('差值刚好10不为恶手', () => {
      expect(isBlunder(55, 65)).toBe(false);
    });
    it('差值为0', () => {
      expect(isBlunder(65, 65)).toBe(false);
    });
    it('实际胜率更高时不为恶手', () => {
      expect(isBlunder(70, 65)).toBe(false);
    });
    it('边界情况：差值11', () => {
      expect(isBlunder(54, 65)).toBe(true);
    });
  });

  describe('classifyBadMove', () => {
    it('轻微失误：10-15%', () => {
      expect(classifyBadMove(11)).toBe('minor');
      expect(classifyBadMove(14)).toBe('minor');
      expect(classifyBadMove(10)).toBe('minor');
    });
    it('中等恶手：15-20%', () => {
      expect(classifyBadMove(15)).toBe('moderate');
      expect(classifyBadMove(19)).toBe('moderate');
    });
    it('严重恶手：>20%', () => {
      expect(classifyBadMove(20)).toBe('severe');
      expect(classifyBadMove(25)).toBe('severe');
      expect(classifyBadMove(50)).toBe('severe');
    });
    it('非恶手：<10%', () => {
      expect(classifyBadMove(9)).toBeNull();
      expect(classifyBadMove(0)).toBeNull();
    });
  });

  describe('calcDifficulty', () => {
    it('差值>15为简单', () => {
      expect(calcDifficulty(65, 40)).toBe('easy');
    });
    it('差值在5-15为中等', () => {
      expect(calcDifficulty(65, 55)).toBe('medium');
    });
    it('差值<5为困难', () => {
      expect(calcDifficulty(65, 62)).toBe('hard');
    });
    it('差值刚好15为中等', () => {
      expect(calcDifficulty(65, 50)).toBe('medium');
    });
    it('差值刚好5为困难', () => {
      expect(calcDifficulty(65, 60)).toBe('hard');
    });
    it('差值刚好16为简单', () => {
      expect(calcDifficulty(65, 49)).toBe('easy');
    });
  });

  describe('classifyPhase', () => {
    it('手数≤60为布局', () => {
      expect(classifyPhase(30)).toBe('layout');
      expect(classifyPhase(1)).toBe('layout');
      expect(classifyPhase(60)).toBe('layout');
    });
    it('手数61-180为中盘', () => {
      expect(classifyPhase(100)).toBe('middle');
      expect(classifyPhase(61)).toBe('middle');
      expect(classifyPhase(180)).toBe('middle');
    });
    it('手数>180为收官', () => {
      expect(classifyPhase(200)).toBe('endgame');
      expect(classifyPhase(181)).toBe('endgame');
    });
    it('边界情况：手数0', () => {
      expect(classifyPhase(0)).toBe('layout');
    });
  });

  describe('parseRank', () => {
    it('解析职业段位（中文九段）', () => {
      expect(parseRank('九段')).toBe('pro');
    });
    it('解析职业段位（P9段格式）', () => {
      expect(parseRank('P9段')).toBe('pro');
    });
    it('解析职业段位（职业X段）', () => {
      expect(parseRank('职业九段')).toBe('pro');
    });
    it('解析高段位业余（5段及以上）', () => {
      expect(parseRank('5段')).toBe('high');
      expect(parseRank('6段')).toBe('high');
      expect(parseRank('7段')).toBe('high');
    });
    it('解析普通段位（1-4段）', () => {
      expect(parseRank('3d')).toBe('normal');
      expect(parseRank('1段')).toBe('normal');
      expect(parseRank('4d')).toBe('normal');
    });
    it('解析级位', () => {
      expect(parseRank('5k')).toBe('normal');
      expect(parseRank('10级')).toBe('normal');
    });
    it('undefined返回null', () => {
      expect(parseRank(undefined)).toBe(null);
    });
    it('空字符串返回null', () => {
      expect(parseRank('')).toBe(null);
    });
    it('无效格式返回null', () => {
      expect(parseRank('unknown')).toBe(null);
    });
    it('带空格的段位', () => {
      expect(parseRank(' 5段 ')).toBe('high');
    });
  });

  describe('determineGameLevel', () => {
    it('取较高等级（职业优先）', () => {
      expect(determineGameLevel('九段', '5段')).toBe('pro');
    });
    it('取较高等级（高段次之）', () => {
      expect(determineGameLevel('5段', '3d')).toBe('high');
    });
    it('双方无段位返回普通', () => {
      expect(determineGameLevel(undefined, undefined)).toBe('normal');
    });
    it('仅一方有段位', () => {
      expect(determineGameLevel('5段', undefined)).toBe('high');
      expect(determineGameLevel(undefined, '九段')).toBe('pro');
    });
    it('双方普通段位', () => {
      expect(determineGameLevel('3d', '2段')).toBe('normal');
    });
  });

  describe('generateProblemId', () => {
    it('生成题目ID', () => {
      expect(generateProblemId('game123', 50)).toBe('game123-m50');
    });
    it('手数为1', () => {
      expect(generateProblemId('abc', 1)).toBe('abc-m1');
    });
    it('手数为0', () => {
      expect(generateProblemId('test', 0)).toBe('test-m0');
    });
    it('gameId含特殊字符', () => {
      expect(generateProblemId('game-2024', 100)).toBe('game-2024-m100');
    });
  });
});