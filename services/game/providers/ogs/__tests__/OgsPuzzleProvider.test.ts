/**
 * @fileoverview OGS Puzzle Provider 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OgsPuzzleProvider } from '../OgsPuzzleProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';

describe('OgsPuzzleProvider', () => {
  let provider: OgsPuzzleProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;
    provider = new OgsPuzzleProvider(mockNetwork);
  });

  describe('URL 匹配', () => {
    it('应该匹配 /puzzle/ URL', () => {
      expect(provider.canHandle('https://online-go.com/puzzle/45')).toBe(true);
    });

    it('应该匹配 /puzzles/ URL', () => {
      expect(provider.canHandle('https://online-go.com/puzzles/45')).toBe(true);
    });

    it('不应该匹配 /game/ URL', () => {
      expect(provider.canHandle('https://online-go.com/game/45')).toBe(false);
    });
  });

  describe('extractId', () => {
    it('应该从 /puzzle/ URL 提取 ID', () => {
      expect(provider.extractId('https://online-go.com/puzzle/45')).toBe('45');
    });

    it('应该从 /puzzles/ URL 提取 ID', () => {
      expect(provider.extractId('https://online-go.com/puzzles/45')).toBe('45');
    });

    it('应该对无效 URL 返回 null', () => {
      expect(provider.extractId('https://example.com/test')).toBe(null);
    });
  });

  describe('fetch', () => {
    it('应该成功下载死活题并生成 101 格式 SGF', async () => {
      const mockPuzzleResponse = {
        id: 45,
        order: 1.0,
        owner: { id: 65831, username: 'Oni', country: 'fi', ranking: 23 },
        name: 'Problem 1',
        created: '2014-09-12T14:52:03Z',
        modified: '2026-09-17T00:07:14Z',
        puzzle: {
          name: 'Problem 1',
          puzzle_rank: '0',
          move_tree: {
            x: -1,
            y: -1,
            branches: [
              {
                x: 0,
                y: 1,
                correct_answer: true,
                text: 'Good',
              },
              {
                x: 0,
                y: 4,
                wrong_answer: true,
                branches: [
                  {
                    x: 0,
                    y: 1,
                    text: 'Now white got two eyes.',
                  },
                ],
              },
            ],
          },
          initial_player: 'black',
          height: 9,
          width: 9,
          mode: 'puzzle',
          puzzle_collection: '18',
          puzzle_type: 'life_and_death',
          initial_state: {
            white: 'dbdacbabbb',
            black: 'ebfbdcccbcbe',
          },
          puzzle_description: 'Black to kill.',
        },
        private: false,
        width: 9,
        height: 9,
        type: 'life_and_death',
        has_solution: true,
        rating: 4.5,
        rating_count: 9,
        rank: 0,
      };

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify(mockPuzzleResponse),
      });

      const result = await provider.fetch('https://online-go.com/puzzle/45');

      expect(result.success).toBe(true);
      expect(result.source).toBe('ogs-puzzle');
      expect(result.sgfContent).toContain('GM[1]');
      expect(result.sgfContent).toContain('SZ[9]');
      expect(result.sgfContent).toContain('AB[');
      expect(result.sgfContent).toContain('AW[');
      // Should have 正解图 and 失败图 branches
      expect(result.sgfContent).toContain('正解图');
      expect(result.sgfContent).toContain('失败图');
      // 正解图 should come before 失败图
      const correctIdx = result.sgfContent.indexOf('正解图');
      const wrongIdx = result.sgfContent.indexOf('失败图');
      expect(correctIdx).toBeLessThan(wrongIdx);
      // Black first (no PL[W])
      expect(result.sgfContent).not.toContain('PL[W]');
    });

    it('应该处理白先题目', async () => {
      const mockPuzzleResponse = {
        id: 100,
        name: 'White first test',
        created: '2020-01-01T00:00:00Z',
        modified: '2020-01-01T00:00:00Z',
        puzzle: {
          name: 'White first test',
          puzzle_rank: '5',
          move_tree: {
            x: -1,
            y: -1,
            branches: [
              {
                x: 5,
                y: 5,
                correct_answer: true,
              },
            ],
          },
          initial_player: 'white',
          height: 19,
          width: 19,
          mode: 'puzzle',
          puzzle_type: 'tesuji',
          initial_state: {
            white: '',
            black: 'dddd',
          },
        },
        private: false,
        width: 19,
        height: 19,
        type: 'tesuji',
        has_solution: true,
        rank: 25,
      };

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify(mockPuzzleResponse),
      });

      const result = await provider.fetch('https://online-go.com/puzzle/100');

      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('PL[W]');
    });

    it('应该处理无效 URL', async () => {
      const result = await provider.fetch('https://example.com/test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('无法从 URL 提取题目 ID');
    });

    it('应该处理 API 错误', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await provider.fetch('https://online-go.com/puzzle/999');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('fetchById', () => {
    it('应该通过 ID 获取死活题', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify({
          id: 45,
          name: 'Test',
          created: '2020-01-01T00:00:00Z',
          modified: '2020-01-01T00:00:00Z',
          puzzle: {
            name: 'Test',
            puzzle_rank: '0',
            move_tree: {
              x: -1,
              y: -1,
              branches: [{ x: 0, y: 0, correct_answer: true }],
            },
            initial_player: 'black',
            height: 9,
            width: 9,
            mode: 'puzzle',
            puzzle_type: 'life_and_death',
            initial_state: { white: '', black: '' },
          },
          private: false,
          width: 9,
          height: 9,
          type: 'life_and_death',
          has_solution: true,
          rank: 0,
        }),
      });

      const result = await provider.fetchById('45');
      expect(result.success).toBe(true);
      expect(result.metadata.gameId).toBe('45');
    });
  });

  describe('坐标转换', () => {
    it('应该正确转换坐标到 SGF 格式', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify({
          id: 1,
          name: 'Coord test',
          created: '2020-01-01T00:00:00Z',
          modified: '2020-01-01T00:00:00Z',
          puzzle: {
            name: 'Coord test',
            puzzle_rank: '0',
            move_tree: {
              x: -1,
              y: -1,
              branches: [
                {
                  x: 0,
                  y: 0,
                  correct_answer: true,
                },
                {
                  x: 18,
                  y: 18,
                  wrong_answer: true,
                },
              ],
            },
            initial_player: 'black',
            height: 19,
            width: 19,
            mode: 'puzzle',
            puzzle_type: 'test',
            initial_state: { white: '', black: '' },
          },
          private: false,
          width: 19,
          height: 19,
          type: 'test',
          has_solution: true,
          rank: 0,
        }),
      });

      const result = await provider.fetch('https://online-go.com/puzzle/1');
      expect(result.success).toBe(true);
      // (0,0) → aa, (18,18) → ss
      expect(result.sgfContent).toContain(';B[aa]');
      expect(result.sgfContent).toContain(';B[ss]');
    });
  });
});
