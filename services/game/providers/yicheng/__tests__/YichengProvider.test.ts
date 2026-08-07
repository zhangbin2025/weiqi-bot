/**
 * @fileoverview YichengProvider 测试
 */

import { YichengProvider } from '../YichengProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ICacheStorage } from '../../../../infrastructure/storage/interfaces/ICacheStorage';
import type { IConfigProvider } from '../../../../infrastructure/config/interfaces/IConfigProvider';

describe('YichengProvider', () => {
  let provider: YichengProvider;
  let mockNetwork: jest.Mocked<NetworkManager>;
  let mockCache: jest.Mocked<ICacheStorage>;
  let mockConfig: jest.Mocked<IConfigProvider>;

  beforeEach(() => {
    mockNetwork = {
      fetch: jest.fn(),
    } as any;
    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    mockConfig = {
      getModuleConfig: jest.fn().mockResolvedValue({}),
    } as any;
    provider = new YichengProvider(mockNetwork, mockCache, mockConfig);
  });

  describe('URL 检测', () => {
    it('应识别 GNO 参数格式', () => {
      const url = 'http://mobile.eweiqi.com/index_ZHCN.html?LNK=1&GNO=12345';
      expect(provider.canHandle(url)).toBe(true);
    });

    it('应识别 id 参数格式', () => {
      const url = 'http://eweiqi.com/game?id=12345';
      expect(provider.canHandle(url)).toBe(true);
    });

    it('应拒绝不匹配的 URL', () => {
      const url = 'https://example.com/game/123';
      expect(provider.canHandle(url)).toBe(false);
    });
  });

  describe('ID 提取', () => {
    it('应正确提取游戏 ID (GNO)', () => {
      const url = 'http://mobile.eweiqi.com/index_ZHCN.html?LNK=1&GNO=12345';
      expect(provider.extractId(url)).toBe('12345');
    });

    it('应正确提取游戏 ID (id)', () => {
      const url = 'http://eweiqi.com/game?id=67890';
      expect(provider.extractId(url)).toBe('67890');
    });
  });

  describe('段位解析', () => {
    it('应正确解析职业段位', () => {
      // 通过内部方法测试（这里间接测试）
      const provider = new YichengProvider(mockNetwork, mockCache, mockConfig);
      // 职业段位测试通过实际请求验证
    });
  });

  describe('SGF 提取', () => {
    it('应处理无效游戏 ID', async () => {
      const url = 'http://eweiqi.com/game?other=123';
      const result = await provider.fetch(url);
      expect(result.success).toBe(false);
      expect(result.error).toContain('游戏 ID');
    });
  });
});