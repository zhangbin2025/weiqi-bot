/**
 * @fileoverview izis围棋提供者测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { IzisProvider } from '../IzisProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

/**
 * IzisProvider.fetch() 的第一段总会先直接 POST app.izis.cn（Node 下用 require('http')）。
 * 本文件只验证「Sniffer 不可用时返回友好错误」，不该依赖真实网络能否连通：
 * 不隔离时该请求偶尔被挂住，会撞上 vitest 5s 用例超时（http 自己的 15s 超时还没到），
 * 全量并发跑时尤其容易偶发红灯。
 *
 * 用 createRequire 拿到与产品代码 require('http') 同一个 CJS 实例，再 spyOn 它的
 * request：打桩成「立即 error 的假请求」，让直接 API 这一步确定性失败，fetch() 必然
 * 走到 Sniffer 判定分支。零网络、零等待，也不改产品代码。
 * （vi.mock('http') 会被 hoist 且与 CJS require 不是同一实例，故不用。）
 */
const nodeHttp = createRequire(import.meta.url)('http') as typeof import('http');
let httpRequestSpy: ReturnType<typeof vi.spyOn>;

function fakeHttpRequest() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners.set(event, cb);
      return this;
    },
    setTimeout() { return this; },
    write() { /* 丢弃请求体 */ },
    destroy() { /* 不打真实网络，无需销毁 */ },
    end() {
      // 下一个 tick 报错，模拟连接失败；callIzisApi 的 Promise 随即 reject。
      queueMicrotask(() => listeners.get('error')?.(new Error('network disabled in test')));
    },
  };
}

describe('IzisProvider', () => {
  let provider: IzisProvider;
  let mockSnifferProvider: ISnifferProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();
    httpRequestSpy = vi.spyOn(nodeHttp, 'request').mockImplementation(
      fakeHttpRequest as unknown as typeof nodeHttp.request,
    );

    mockNetwork = {} as NetworkManager;

    mockSnifferProvider = {
      name: 'playwright-sniffer',
      displayName: 'Playwright Sniffer',
      isAvailable: vi.fn().mockReturnValue(true),
      start: vi.fn().mockRejectedValue(new Error('Sniffer 不该在不可用分支被调用')),
      getEnvironmentDescription: vi.fn().mockReturnValue('CLI 环境'),
    } as unknown as ISnifferProvider;

    provider = new IzisProvider(mockNetwork, mockSnifferProvider);
  });

  afterEach(() => {
    httpRequestSpy.mockRestore();
  });

  describe('基础信息', () => {
    it('应提供正确的名称和显示名称', () => {
      expect(provider.name).toBe('izis');
      expect(provider.displayName).toBe('隐智智能棋盘');
    });

    it('应检测支持的 URL', () => {
      expect(provider.canHandle('http://app.izis.cn/web/#/live_detail?gameId=12345&type=2')).toBe(true);
      expect(provider.canHandle('https://izis.cn/live?gameId=67890')).toBe(true);
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(false);
    });

    it('应从 URL 提取游戏 ID', () => {
      expect(provider.extractId('http://app.izis.cn/web/#/live_detail?gameId=12345&type=2')).toBe('12345');
      expect(provider.extractId('https://izis.cn/live?gameId=67890')).toBe('67890');
    });
  });

  describe('Sniffer 不可用', () => {
    it('Sniffer 不可用时应返回友好错误', async () => {
      vi.mocked(mockSnifferProvider.isAvailable).mockReturnValue(false);

      const result = await provider.fetch('http://app.izis.cn/web/#/live_detail?gameId=12345&type=2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
      // 直接 API 已确定性失败，且 Sniffer 不可用 → 绝不启动抓包会话
      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      expect(mockSnifferProvider.start).not.toHaveBeenCalled();
    });
  });
});
