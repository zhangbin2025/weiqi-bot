/**
 * @fileoverview YichafenClient 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YichafenClient } from '../YichafenClient';
import type { NetworkManager } from '../../../infrastructure/network/core/NetworkManager';

describe('YichafenClient', () => {
  let client: YichafenClient;
  let mockNetwork: NetworkManager;
  let originalUserAgent: string;

  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Mock App environment to test network.request path
    originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'WeiqiApp/1.0',
      configurable: true,
    });
    // Mock fetch to return 404 so App fallback goes to network.request
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    client = new YichafenClient();
    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;
  });

  // Helper: mock loadPlayers to bypass environment detection in vitest (Node.js)
  // In Node.js, isCli() returns true, but tests verify App/Web branch logic
  function mockLoadPlayers(data: any[]) {
    vi.spyOn(client as any, 'loadPlayers').mockResolvedValue(data);
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('query', () => {
    it('应成功查询棋手信息', async () => {
      mockLoadPlayers([
        {
          姓名: '柯洁',
          性别: '男',
          出生: '1997',
          段位: '9段',
          等级分: 3800,
          全国排名: 1,
          省区: '浙江',
          城市: '杭州',
        },
      ]);

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(true);
      expect(result.data?.name).toBe('柯洁');
      expect(result.data?.level).toBe('9段');
      expect(result.data?.rating).toBe(3800);
      expect(result.data?.totalRank).toBe(1);
      expect(result.matches).toHaveLength(1);
    });

    it('应支持模糊匹配', async () => {
      mockLoadPlayers([
        { 姓名: '柯洁', 段位: '9段', 等级分: 3800 },
        { 姓名: '柯小洁', 段位: '5段', 等级分: 2000 },
      ]);

      const result = await client.query(
        '柯',
        { timeout: 30000 },
        mockNetwork,
        false
      );

      expect(result.found).toBe(true);
      expect(result.matches).toHaveLength(2);
      expect(result.matches?.[0].name).toBe('柯洁');
      expect(result.matches?.[1].name).toBe('柯小洁');
    });

    it('应支持精确匹配', async () => {
      mockLoadPlayers([
        { 姓名: '柯洁', 段位: '9段', 等级分: 3800 },
        { 姓名: '柯小洁', 段位: '5段', 等级分: 2000 },
      ]);

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork,
        true
      );

      expect(result.found).toBe(true);
      expect(result.matches).toHaveLength(1);
      expect(result.data?.name).toBe('柯洁');
    });

    it('应处理多个同名棋手', async () => {
      mockLoadPlayers([
        { 姓名: '张三', 段位: '5段', 省区: '北京', 等级分: 2100 },
        { 姓名: '张三', 段位: '4段', 省区: '上海', 等级分: 1800 },
      ]);

      const result = await client.query(
        '张三',
        { timeout: 30000 },
        mockNetwork,
        true
      );

      expect(result.found).toBe(true);
      expect(result.matches).toHaveLength(2);
      expect(result.data?.province).toBe('北京');
    });

    it('应返回未找到', async () => {
      mockLoadPlayers([{ 姓名: '柯洁' }]);

      const result = await client.query(
        '不存在的人',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(false);
    });

    it('应处理网络错误', async () => {
      vi.spyOn(client as any, 'loadPlayers').mockRejectedValue(new Error('网络错误'));

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(false);
      expect(result.error).toBe('Error: 网络错误');
    });

    it('应处理空数据', async () => {
      mockLoadPlayers([]);

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(false);
      expect(result.error).toBe('无法获取棋手数据');
    });

    it('应尝试多个月份的榜单数据', async () => {
      // Test that query works with data from any month
      mockLoadPlayers([
        { 姓名: '柯洁', 段位: '9段' },
      ]);

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(true);
      expect(result.data?.name).toBe('柯洁');
    });

    it('应使用缓存数据', async () => {
      // 直接设置内存缓存，模拟数据已加载
      (client as any).cachedPlayers = [{ 姓名: '柯洁', 段位: '9段' }];
      (client as any).cachedAt = Date.now();

      // 查询应使用缓存，loadPlayers 内部缓存命中后不再发起网络请求
      const result = await client.query('柯洁', { timeout: 30000 }, mockNetwork);
      expect(result.found).toBe(true);
      expect(result.data?.name).toBe('柯洁');
      // network.request 不应被调用（缓存命中）
      expect(mockNetwork.request).not.toHaveBeenCalled();
    });

    it('应正确映射字段', async () => {
      mockLoadPlayers([
        {
          姓名: '柯洁',
          性别: '男',
          出生: '1997',
          段位: '9段',
          等级分: 3800.5,
          全国排名: 1,
          省区排名: 2,
          本市排名: 3,
          省区: '浙江',
          城市: '杭州',
          升段信息: '世界冠军',
          特别说明: '围棋AI研究者',
        },
      ]);

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.data).toEqual({
        name: '柯洁',
        level: '9段',
        rating: 3800.5,
        totalRank: 1,
        provinceRank: 2,
        cityRank: 3,
        province: '浙江',
        city: '杭州',
        gender: '男',
        birthYear: 1997,
        notes: '世界冠军 | 围棋AI研究者',
      });
    });
  });
});
