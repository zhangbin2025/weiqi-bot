/**
 * @fileoverview YuanluoboProvider 测试
 */

import { YuanluoboProvider } from '../YuanluoboProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ICacheStorage } from '../../../../infrastructure/storage/interfaces/ICacheStorage';
import type { IConfigProvider } from '../../../../infrastructure/config/interfaces/IConfigProvider';

describe('YuanluoboProvider', () => {
  let provider: YuanluoboProvider;
  let mockNetwork: jest.Mocked<NetworkManager>;
  let mockCache: jest.Mocked<ICacheStorage>;
  let mockConfig: jest.Mocked<IConfigProvider>;

  beforeEach(() => {
    mockNetwork = {
      request: jest.fn(),
      fetch: jest.fn(),
    } as any;
    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      has: jest.fn().mockResolvedValue(false),
    };
    mockConfig = {
      getModuleConfig: jest.fn().mockResolvedValue({}),
    } as any;
    provider = new YuanluoboProvider(mockNetwork, mockCache, mockConfig);
  });

  describe('URL 检测', () => {
    it('应识别标准 URL 格式', () => {
      const url = 'https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=abc123';
      expect(provider.canHandle(url)).toBe(true);
    });

    it('应识别不带 jupiter 前缀的 URL', () => {
      const url = 'https://yuanluobo.com/review?session_id=abc123';
      expect(provider.canHandle(url)).toBe(true);
    });

    it('应拒绝不匹配的 URL', () => {
      const url = 'https://example.com/game/123';
      expect(provider.canHandle(url)).toBe(false);
    });
  });

  describe('ID 提取', () => {
    it('应正确提取 session_id', () => {
      const url = 'https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=abc123';
      expect(provider.extractId(url)).toBe('abc123');
    });
  });

  describe('SGF 提取', () => {
    it('应处理 API 错误', async () => {
      const url = 'https://jupiter.yuanluobo.com/robot-public/all-in-app/go/review?session_id=abc123';
      mockNetwork.request.mockResolvedValueOnce({
        data: { code: 400001, message: '错误', data: null },
      } as any);

      const result = await provider.fetch(url);
      expect(result.success).toBe(false);
      expect(result.error).toContain('错误');
    });

    it('应处理无效 session_id', async () => {
      const url = 'https://jupiter.yuanluobo.com/review?other=123';
      const result = await provider.fetch(url);
      expect(result.success).toBe(false);
      expect(result.error).toContain('session_id');
    });
  });
});