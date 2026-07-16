import { describe, it, expect } from 'vitest';
import { ShareService } from '../ShareService.js';
import type { EncodedMove } from '../../../domain/share/index.js';

describe('ShareService', () => {
  describe('构造函数', () => {
    it('使用默认基础URL', () => {
      const service = new ShareService();
      expect(service.baseUrl).toBe('https://weiqi-dev.github.io/weiqi-assets/share/');
    });

    it('支持自定义基础URL', () => {
      const customUrl = 'https://example.com/share/';
      const service = new ShareService(customUrl);
      expect(service.baseUrl).toBe(customUrl);
    });
  });

  describe('generateShareUrl', () => {
    it('生成分享链接', () => {
      const service = new ShareService('https://example.com/share/');
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },
        { color: 'W', x: 15, y: 15 }
      ];
      
      const url = service.generateShareUrl(moves);
      expect(url).not.toBeNull();
      expect(url).toContain('https://example.com/share/');
      expect(url).toContain('?d=');
    });

    it('空手数返回null', () => {
      const service = new ShareService();
      const url = service.generateShareUrl([]);
      expect(url).toBeNull();
    });

    it('URL包含编码参数', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 9, y: 9 }
      ];
      
      const url = service.generateShareUrl(moves);
      expect(url).not.toBeNull();
      
      const urlObj = new URL(url!);
      expect(urlObj.searchParams.has('d')).toBe(true);
      expect(urlObj.searchParams.get('d')?.length).toBeGreaterThan(0);
    });

    it('使用默认棋盘大小19', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 9, y: 9 }
      ];
      
      const url = service.generateShareUrl(moves);
      const decoded = service.decodeShareUrl(url!);
      expect(decoded?.boardSize).toBe(19);
    });

    it('支持自定义棋盘大小', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 4, y: 4 }
      ];
      
      const url = service.generateShareUrl(moves, 9);
      const decoded = service.decodeShareUrl(url!);
      expect(decoded?.boardSize).toBe(9);
    });

    it('支持让子数', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'W', x: 9, y: 9 }
      ];
      
      const url = service.generateShareUrl(moves, 19, 3);
      const decoded = service.decodeShareUrl(url!);
      expect(decoded?.handicap).toBe(3);
    });
  });

  describe('decodeShareUrl', () => {
    it('解码有效URL', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },
        { color: 'W', x: 15, y: 15 }
      ];
      
      const url = service.generateShareUrl(moves);
      const decoded = service.decodeShareUrl(url!);
      
      expect(decoded).not.toBeNull();
      expect(decoded?.moves).toEqual(moves);
    });

    it('解码无效URL返回null', () => {
      const service = new ShareService();
      const result = service.decodeShareUrl('not-a-valid-url');
      expect(result).toBeNull();
    });

    it('解码无参数URL返回null', () => {
      const service = new ShareService();
      const result = service.decodeShareUrl('https://example.com/share/');
      expect(result).toBeNull();
    });

    it('解码空参数返回null', () => {
      const service = new ShareService();
      const result = service.decodeShareUrl('https://example.com/share/?d=');
      expect(result).toBeNull();
    });
  });

  describe('decodeParam', () => {
    it('解码有效参数', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 }
      ];
      
      const url = service.generateShareUrl(moves);
      const urlObj = new URL(url!);
      const param = urlObj.searchParams.get('d')!;
      
      const decoded = service.decodeParam(param);
      expect(decoded).not.toBeNull();
      expect(decoded?.moves).toEqual(moves);
    });

    it('解码无效参数返回null', () => {
      const service = new ShareService();
      const result = service.decodeParam('invalid-param');
      expect(result).toBeNull();
    });
  });

  describe('toSGF', () => {
    it('转换为SGF格式', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },
        { color: 'W', x: 15, y: 15 }
      ];
      
      const url = service.generateShareUrl(moves);
      const decoded = service.decodeShareUrl(url!);
      const sgf = service.toSGF(decoded!);
      
      expect(sgf).toContain('GM[1]');
      expect(sgf).toContain('SZ[19]');
      expect(sgf).toContain(';B[dd]');
      expect(sgf).toContain(';W[pp]');
    });

    it('包含完整SGF结构', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 9, y: 9 }
      ];
      
      const url = service.generateShareUrl(moves, 9, 0);
      const decoded = service.decodeShareUrl(url!);
      const sgf = service.toSGF(decoded!);
      
      expect(sgf).toContain('GM[1]');
      expect(sgf).toContain('FF[4]');
      expect(sgf).toContain('CA[UTF-8]');
      expect(sgf).toContain('AP[WeiqiRecorder]');
      expect(sgf).toContain('KM[0]');
      expect(sgf).toContain('SZ[9]');
    });
  });

  describe('完整工作流', () => {
    it('端到端测试：生成->解码->转SGF', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 3, y: 3 },   // 星位
        { color: 'W', x: 15, y: 15 }, // 星位
        { color: 'B', x: 9, y: 9 },   // 天元
        { color: 'W', x: 2, y: 16 },
        { color: 'B', x: 16, y: 2 }
      ];
      
      // 生成分享链接
      const url = service.generateShareUrl(moves, 19, 0);
      expect(url).not.toBeNull();
      
      // 解码
      const decoded = service.decodeShareUrl(url!);
      expect(decoded).not.toBeNull();
      expect(decoded?.boardSize).toBe(19);
      expect(decoded?.handicap).toBe(0);
      expect(decoded?.moves).toEqual(moves);
      
      // 转SGF
      const sgf = service.toSGF(decoded!);
      expect(sgf).toContain('SZ[19]');
      expect(sgf).toContain(';B[dd]');
      expect(sgf).toContain(';W[pp]');
      expect(sgf).toContain(';B[jj]');
    });

    it('完整往返测试（小棋盘）', () => {
      const service = new ShareService();
      const moves: EncodedMove[] = [
        { color: 'B', x: 4, y: 4 }, // 9路棋盘中心
        { color: 'W', x: 2, y: 6 }
      ];
      
      const url = service.generateShareUrl(moves, 9, 0);
      const decoded = service.decodeShareUrl(url!);
      
      expect(decoded?.boardSize).toBe(9);
      expect(decoded?.moves).toEqual(moves);
    });
  });

  describe('错误处理', () => {
    it('处理畸形URL', () => {
      const service = new ShareService();
      const result = service.decodeShareUrl('://malformed-url');
      expect(result).toBeNull();
    });

    it('处理缺少协议的URL', () => {
      const service = new ShareService();
      const result = service.decodeShareUrl('example.com/share?d=abc');
      expect(result).toBeNull();
    });

    it('处理非Base64参数', () => {
      const service = new ShareService();
      const result = service.decodeParam('not-valid-base64!!!');
      expect(result).toBeNull();
    });
  });
});