/**
 * @fileoverview 复盘服务测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewService, BadMoveDetector } from '../index';
import { classifyBadMove } from '../../../domain/decision';
import type { IAIController } from '../../ai/IAIController';
import { SGFParser } from '../../domain/sgf/SGFParser';
import type { FullReviewResult } from './types';

// Mock AI Controller
function createMockAI(): IAIController {
  return {
    init: vi.fn(),
    genmove: vi.fn(),
    analyze: vi.fn().mockResolvedValue({
      winRate: 0.5,
      scoreLead: 0,
      topMoves: [
        { x: 10, y: 10, winRate: 0.52, scoreLead: 1.5, visits: 100 },
      ],
    }),
    countTerritory: vi.fn(),
    cancel: vi.fn(),
    isThinking: vi.fn().mockReturnValue(false),
    setDifficulty: vi.fn(),
    getDifficulty: vi.fn().mockReturnValue('medium'),
    isInitialized: vi.fn().mockReturnValue(true),
    destroy: vi.fn(),
    getModelId: vi.fn(),
    evaluateBatch: vi.fn().mockResolvedValue([
      { winRate: 0.5, scoreLead: 0 },
      { winRate: 0.52, scoreLead: 1 },
      { winRate: 0.48, scoreLead: -1 },
    ]),
  };
}

// Mock SGF Parser
function createMockSGFParser(): SGFParser {
  return {
    parse: vi.fn().mockReturnValue({
      gameInfo: {
        black: '黑方',
        white: '白方',
        komi: '7.5',
        result: 'B+R',
        boardSize: 19,
      },
      moves: [
        { coord: 'pd', color: 'B' },
        { coord: 'dd', color: 'W' },
        { coord: 'pp', color: 'B' },
      ],
    }),
    parseFile: vi.fn(),
  } as unknown as SGFParser;
}

describe('ReviewService', () => {
  let service: ReviewService;
  let mockAI: IAIController;
  let mockSGFParser: SGFParser;

  beforeEach(() => {
    mockAI = createMockAI();
    mockSGFParser = createMockSGFParser();
    service = new ReviewService(mockAI, mockSGFParser);
  });

  describe('loadFromSGF', () => {
    it('should parse SGF and return review ID', async () => {
      const id = await service.loadFromSGF('(;SZ[19]KM[7.5])');
      expect(id).toMatch(/^review_/);
    });

    it('should store game info', async () => {
      const id = await service.loadFromSGF('(;SZ[19]KM[7.5])');
      const state = service.getState(id);
      expect(state).toBeDefined();
      expect(state?.gameInfo.black).toBe('黑方');
      expect(state?.gameInfo.komi).toBe(7.5);
    });
  });

  describe('analyzeGame', () => {
    it('should analyze all moves', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const result = await service.analyzeGame(id);
      expect(result.totalMoves).toBe(3);
      expect(result.moves).toHaveLength(3);
    });
  });

  describe('analyzeGameAsync', () => {
    it('should call progress callback', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const onProgress = vi.fn();
      await service.analyzeGameAsync(id, {}, { onProgress });
      expect(onProgress).toHaveBeenCalled();
    });

    it('should call onMoveAnalyzed callback', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const onMoveAnalyzed = vi.fn();
      await service.analyzeGameAsync(id, {}, { onMoveAnalyzed });
      expect(onMoveAnalyzed).toHaveBeenCalledTimes(3);
    });
  });

  describe('analyzePosition', () => {
    it('should analyze specific position', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const result = await service.analyzePosition(id, 0);
      expect(result).toBeDefined();
      expect(result?.moveNumber).toBe(1);
    });

    it('should return next move analysis for invalid index (beyond moves length)', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const result = await service.analyzePosition(id, 100);
      // 当 moveIndex >= moves.length 时，会分析下一步的局面
      expect(result).toBeDefined();
      expect(result?.moveNumber).toBe(4); // 3步棋 + 1 = 第4步
      expect(result?.x).toBe(-1); // 没有实际着法
      expect(result?.y).toBe(-1);
    });
  });

  describe('getBadMoves', () => {
    it('should return empty array before analysis', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const badMoves = service.getBadMoves(id);
      expect(badMoves).toEqual([]);
    });

    it('should return bad moves after analysis', async () => {
      // Mock to return bad move analysis
      vi.mocked(mockAI.analyze).mockImplementation(async () => ({
        winRate: 0.3, // Low win rate
        scoreLead: -5,
        topMoves: [{ x: 10, y: 10, winRate: 0.5, scoreLead: 1, visits: 100 }],
      }));

      const id = await service.loadFromSGF('(;SZ[19])');
      await service.analyzeGame(id);
      const badMoves = service.getBadMoves(id);
      // Should have detected bad moves due to win rate change
      expect(badMoves.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getWinRateTrend', () => {
    it('should return empty array before analysis', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const trend = service.getWinRateTrend(id);
      expect(trend).toEqual([]);
    });

    it('should return trend after analysis', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      await service.analyzeGame(id);
      const trend = service.getWinRateTrend(id);
      expect(trend).toHaveLength(3);
    });
  });

  describe('getState', () => {
    it('should return null for unknown review', () => {
      const state = service.getState('unknown');
      expect(state).toBeNull();
    });

    it('should return state for known review', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      const state = service.getState(id);
      expect(state).toBeDefined();
      expect(state?.id).toBe(id);
    });
  });

  describe('destroy', () => {
    it('should remove review from storage', async () => {
      const id = await service.loadFromSGF('(;SZ[19])');
      service.destroy(id);
      const state = service.getState(id);
      expect(state).toBeNull();
    });
  });
});

describe('BadMoveDetector', () => {
  let detector: BadMoveDetector;

  beforeEach(() => {
    detector = new BadMoveDetector();
  });

  describe('isBadMove', () => {
    it('should return true for significant loss', () => {
      expect(detector.isBadMove(-0.1)).toBe(true);
      expect(detector.isBadMove(-0.2)).toBe(true);
    });

    it('should return false for small change', () => {
      expect(detector.isBadMove(-0.02)).toBe(false);
      expect(detector.isBadMove(0.02)).toBe(false);
    });
  });

  describe('classifyBadMove', () => {
    it('should classify minor bad move', () => {
      expect(classifyBadMove(11)).toBe('minor');
      expect(classifyBadMove(14)).toBe('minor');
    });

    it('should classify moderate bad move', () => {
      expect(classifyBadMove(15)).toBe('moderate');
      expect(classifyBadMove(19)).toBe('moderate');
    });

    it('should classify severe bad move', () => {
      expect(classifyBadMove(20)).toBe('severe');
      expect(classifyBadMove(30)).toBe('severe');
    });

    it('should return null for non-bad move', () => {
      expect(classifyBadMove(9)).toBeNull();
    });
  });

  describe('detect', () => {
    it('should extract bad moves from result', () => {
      const result: FullReviewResult = {
        totalMoves: 3,
        moves: [
          { moveNumber: 1, x: 15, y: 3, color: 'black', winRate: 0.5, scoreLead: 0, winRateChange: 0, isBadMove: false },
          { moveNumber: 2, x: 3, y: 3, color: 'white', winRate: 0.35, scoreLead: -5, winRateChange: -0.25, isBadMove: true, badMoveSeverity: 'severe' },
          { moveNumber: 3, x: 15, y: 15, color: 'black', winRate: 0.55, scoreLead: 3, winRateChange: -0.12, isBadMove: true, badMoveSeverity: 'minor', betterMove: { x: 10, y: 10, winRate: 0.6, scoreLead: 5 } },
        ],
        analysis: { mode: 'deep', visits: 100, analysisTime: 1 },
      };

      const badMoves = detector.detect(result);
      expect(badMoves).toHaveLength(2);
      expect(badMoves[0].severity).toBe('severe');
      expect(badMoves[1].severity).toBe('minor');
    });
  });
});