import { describe, it, expect } from 'vitest';
import { GameEncoder, type EncodedMove, type DecodedGame } from '../GameEncoder.js';

describe('GameEncoder', () => {
  describe('encode', () => {
    it('编码空手数列表返回null', () => {
      const result = GameEncoder.encode([]);
      expect(result).toBeNull();
    });

    it('编码单手棋', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 }
      ];
      const result = GameEncoder.encode(moves);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('编码多手棋', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },
        { color: 'W', x: 15, y: 15 },
        { color: 'B', x: 9, y: 9 }
      ];
      const result = GameEncoder.encode(moves);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('编码结果为 URL-safe Base64', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 0, y: 0 }
      ];
      const result = GameEncoder.encode(moves);
      expect(result).not.toBeNull();
      // URL-safe Base64 不应包含 +, /, =
      expect(result).not.toMatch(/[+/=]/);
    });

    it('使用默认棋盘大小19', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 18, y: 18 }
      ];
      const result = GameEncoder.encode(moves);
      expect(result).not.toBeNull();
      
      const decoded = GameEncoder.decode(result!);
      expect(decoded?.boardSize).toBe(19);
    });

    it('支持自定义棋盘大小', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 8, y: 8 }
      ];
      const result = GameEncoder.encode(moves, 9);
      expect(result).not.toBeNull();
      
      const decoded = GameEncoder.decode(result!);
      expect(decoded?.boardSize).toBe(9);
    });

    it('支持让子数', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 }
      ];
      const result = GameEncoder.encode(moves, 19, 3);
      expect(result).not.toBeNull();
      
      const decoded = GameEncoder.decode(result!);
      expect(decoded?.handicap).toBe(3);
    });

    it('正确编码黑白棋子', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 0, y: 0 },
        { color: 'W', x: 1, y: 1 },
        { color: 'B', x: 2, y: 2 }
      ];
      const result = GameEncoder.encode(moves);
      expect(result).not.toBeNull();
      
      const decoded = GameEncoder.decode(result!);
      expect(decoded?.moves[0].color).toBe('B');
      expect(decoded?.moves[1].color).toBe('W');
      expect(decoded?.moves[2].color).toBe('B');
    });

    it('正确编码坐标', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 0, y: 0 },
        { color: 'W', x: 18, y: 18 },
        { color: 'B', x: 9, y: 9 }
      ];
      const result = GameEncoder.encode(moves);
      expect(result).not.toBeNull();
      
      const decoded = GameEncoder.decode(result!);
      expect(decoded?.moves[0]).toEqual({ color: 'B', x: 0, y: 0 });
      expect(decoded?.moves[1]).toEqual({ color: 'W', x: 18, y: 18 });
      expect(decoded?.moves[2]).toEqual({ color: 'B', x: 9, y: 9 });
    });
  });

  describe('decode', () => {
    it('解码有效数据', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },
        { color: 'W', x: 15, y: 15 }
      ];
      const encoded = GameEncoder.encode(moves);
      expect(encoded).not.toBeNull();
      
      const decoded = GameEncoder.decode(encoded!);
      expect(decoded).not.toBeNull();
      expect(decoded?.moves.length).toBe(2);
      expect(decoded?.moves).toEqual(moves);
    });

    it('解码无效数据返回null', () => {
      const result = GameEncoder.decode('invalid-base64!!!');
      expect(result).toBeNull();
    });

    it('解码错误Magic返回null', () => {
      // 构造一个 Magic 错误的数据
      const invalidData = btoa('XXXX' + '\x00\x00');
      const result = GameEncoder.decode(invalidData);
      expect(result).toBeNull();
    });

    it('解码空字符串返回null', () => {
      const result = GameEncoder.decode('');
      expect(result).toBeNull();
    });

    it('解码返回正确的棋盘大小', () => {
      const moves: EncodedMove[] = [{ color: 'B', x: 4, y: 4 }];
      const encoded = GameEncoder.encode(moves, 13)!;
      const decoded = GameEncoder.decode(encoded);
      expect(decoded?.boardSize).toBe(13);
    });

    it('解码返回正确的让子数', () => {
      const moves: EncodedMove[] = [{ color: 'B', x: 3, y: 3 }];
      const encoded = GameEncoder.encode(moves, 19, 5)!;
      const decoded = GameEncoder.decode(encoded);
      expect(decoded?.handicap).toBe(5);
    });
  });

  describe('toSGF', () => {
    it('转换简单棋谱为SGF', () => {
      const game: DecodedGame = {
        boardSize: 19,
        handicap: 0,
        moves: [
          { color: 'B', x: 3, y: 3 },
          { color: 'W', x: 15, y: 15 }
        ]
      };
      const sgf = GameEncoder.toSGF(game);
      
      expect(sgf).toContain('GM[1]');
      expect(sgf).toContain('SZ[19]');
      expect(sgf).toContain(';B[dd]');
      expect(sgf).toContain(';W[pp]');
      expect(sgf.startsWith('(')).toBe(true);
      expect(sgf.endsWith(')')).toBe(true);
    });

    it('包含正确的SGF属性', () => {
      const game: DecodedGame = {
        boardSize: 19,
        handicap: 0,
        moves: []
      };
      const sgf = GameEncoder.toSGF(game);
      
      expect(sgf).toContain('FF[4]');
      expect(sgf).toContain('CA[UTF-8]');
      expect(sgf).toContain('AP[WeiqiRecorder]');
      expect(sgf).toContain('KM[0]');
    });

    it('转换小棋盘棋谱', () => {
      const game: DecodedGame = {
        boardSize: 9,
        handicap: 0,
        moves: [
          { color: 'B', x: 4, y: 4 }
        ]
      };
      const sgf = GameEncoder.toSGF(game);
      expect(sgf).toContain('SZ[9]');
      expect(sgf).toContain(';B[ee]');
    });

    it('转换空棋谱', () => {
      const game: DecodedGame = {
        boardSize: 19,
        handicap: 0,
        moves: []
      };
      const sgf = GameEncoder.toSGF(game);
      expect(sgf).toContain('GM[1]');
      expect(sgf).toContain('SZ[19]');
    });
  });

  describe('编码解码往返测试', () => {
    it('完整往返测试', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },
        { color: 'W', x: 15, y: 15 },
        { color: 'B', x: 9, y: 9 },
        { color: 'W', x: 2, y: 16 },
        { color: 'B', x: 16, y: 2 }
      ];
      
      const encoded = GameEncoder.encode(moves, 19, 0);
      expect(encoded).not.toBeNull();
      
      const decoded = GameEncoder.decode(encoded!);
      expect(decoded).not.toBeNull();
      expect(decoded?.boardSize).toBe(19);
      expect(decoded?.handicap).toBe(0);
      expect(decoded?.moves).toEqual(moves);
    });

    it('大量手数往返测试', () => {
      const moves: EncodedMove[] = [];
      for (let i = 0; i < 100; i++) {
        moves.push({
          color: i % 2 === 0 ? 'B' : 'W',
          x: i % 19,
          y: (i * 3) % 19
        });
      }
      
      const encoded = GameEncoder.encode(moves);
      const decoded = GameEncoder.decode(encoded!);
      expect(decoded?.moves).toEqual(moves);
      expect(decoded?.moves.length).toBe(100);
    });

    it('边界坐标测试', () => {
      const moves: EncodedMove[] = [
        { color: 'B', x: 0, y: 0 },
        { color: 'W', x: 18, y: 18 },
        { color: 'B', x: 0, y: 18 },
        { color: 'W', x: 18, y: 0 }
      ];
      
      const encoded = GameEncoder.encode(moves);
      const decoded = GameEncoder.decode(encoded!);
      expect(decoded?.moves).toEqual(moves);
    });
  });
});