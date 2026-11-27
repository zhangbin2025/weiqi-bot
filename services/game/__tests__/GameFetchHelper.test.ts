/**
 * @fileoverview GameFetchHelper 环境不可用 URL 识别测试
 */

import { describe, expect, it, vi } from 'vitest';
import { GameFetchHelper } from '../GameFetchHelper';

describe('GameFetchHelper environment-dependent URL classification', () => {
  const createHelper = () => {
    const strategy = {
      selectProvider: vi.fn().mockResolvedValue(null),
    };
    const registry = {
      getProviders: vi.fn().mockReturnValue(new Map()),
    };

    return {
      helper: new GameFetchHelper({ strategy: strategy as any, registry: registry as any }),
      strategy,
    };
  };

  it.each([
    ['腾讯围棋', 'https://h5.txwq.qq.com/'],
    ['弈客直播', 'https://www.yikeweiqi.com/room/12345'],
    ['弈客对局', 'https://www.yikeweiqi.com/online-game/12345'],
    ['Golaxy', 'https://golaxy.com/game/12345'],
    ['新博', 'https://www.xinboduiyi.com/game/12345'],
    ['弈客少儿', 'https://shaoer.yikeweiqi.com/game/12345'],
    ['野狐直播', 'https://h5.foxwq.com/?svrtype=20010'],
  ])('%s URL 应标记为 unavailable', async (_platform, url) => {
    const { helper } = createHelper();

    const result = await helper.fetch(url);

    expect(result.success).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.metadata.source).toBe('unavailable');
    expect(result.error).toContain('当前环境不支持');
  });

  it('真正未知的平台 URL 仍应标记为 unknown', async () => {
    const { helper } = createHelper();

    const result = await helper.fetch('https://example.com/game/12345');

    expect(result.success).toBe(false);
    expect(result.source).toBe('unknown');
    expect(result.metadata.source).toBe('unknown');
  });
});
