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

  beforeEach(() => {
    // Mock App environment to test network.request path
    originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'WeiqiApp/1.0',
      configurable: true,
    });
    client = new YichafenClient();
    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  describe('query', () => {
    it('应成功查询棋手信息', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [
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
        ],
      });

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
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [
          { 姓名: '柯洁', 段位: '9段', 等级分: 3800 },
          { 姓名: '柯小洁', 段位: '5段', 等级分: 2000 },
        ],
      });

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
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [
          { 姓名: '柯洁', 段位: '9段', 等级分: 3800 },
          { 姓名: '柯小洁', 段位: '5段', 等级分: 2000 },
        ],
      });

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
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [
          { 姓名: '张三', 段位: '5段', 省区: '北京', 等级分: 2100 },
          { 姓名: '张三', 段位: '4段', 省区: '上海', 等级分: 1800 },
        ],
      });

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
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [{ 姓名: '柯洁' }],
      });

      const result = await client.query(
        '不存在的人',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(false);
    });

    it('应处理网络错误', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('网络错误'));

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(false);
      expect(result.error).toBe('Error: 网络错误');
    });

    it('应处理空数据', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [],
      });

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(false);
      expect(result.error).toBe('无法获取棋手数据');
    });

    it('应尝试加载最近3个月的榜单', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('404'))
        .mockRejectedValueOnce(new Error('404'))
        .mockResolvedValueOnce({
          data: [{ 姓名: '柯洁', 段位: '9段' }],
        });

      const result = await client.query(
        '柯洁',
        { timeout: 30000 },
        mockNetwork
      );

      expect(result.found).toBe(true);
      expect(mockNetwork.request).toHaveBeenCalledTimes(3);
    });

    it('应使用缓存数据', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [{ 姓名: '柯洁', 段位: '9段' }],
      });

      // 第一次查询
      await client.query('柯洁', { timeout: 30000 }, mockNetwork);
      expect(mockNetwork.request).toHaveBeenCalledTimes(1);

      // 第二次查询（应使用缓存）
      await client.query('柯洁', { timeout: 30000 }, mockNetwork);
      expect(mockNetwork.request).toHaveBeenCalledTimes(1);
    });

    it('应正确映射字段', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [
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
        ],
      });

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
