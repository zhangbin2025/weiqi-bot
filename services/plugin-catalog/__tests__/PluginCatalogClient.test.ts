/**
 * PluginCatalogClient 契约测试
 *
 * 重点：URL 拼接与越界防护（这是「下载远程源码」最关键的安全边界），
 * 以及 schemaVersion 闸门、逐字段形状校验。fetch 全部注入，不打真实网络。
 */

import { describe, it, expect } from 'vitest';
import {
  PluginCatalogClient,
  resolveBaseUrl,
  resolveSameOrigin,
} from '../PluginCatalogClient';

const REGISTRY_URL = 'https://weiqi-dev.github.io/weiqi-assets/registry.json';
const BASE = 'https://weiqi-dev.github.io/weiqi-assets/';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as Response;
}

describe('resolveBaseUrl', () => {
  it('用清单 URL 目录兜底，且规范化为带尾斜杠', () => {
    expect(resolveBaseUrl(REGISTRY_URL, undefined))
      .toBe('https://weiqi-dev.github.io/weiqi-assets/');
  });

  it('接受同源 baseUrl', () => {
    expect(resolveBaseUrl(REGISTRY_URL, 'https://weiqi-dev.github.io/weiqi-assets/'))
      .toBe('https://weiqi-dev.github.io/weiqi-assets/');
  });

  it('拒绝跨源 baseUrl', () => {
    expect(() => resolveBaseUrl(REGISTRY_URL, 'https://evil.example.com/'))
      .toThrow('不同源');
  });
});

describe('resolveSameOrigin', () => {
  it('相对路径拼到 base', () => {
    expect(resolveSameOrigin('plugins/ranking/total-score/plugin.json', BASE, REGISTRY_URL))
      .toBe('https://weiqi-dev.github.io/weiqi-assets/plugins/ranking/total-score/plugin.json');
  });

  it('拒绝绝对路径 / 反斜杠 / .. 越界 / 站外', () => {
    expect(() => resolveSameOrigin('/etc/passwd', BASE, REGISTRY_URL)).toThrow('相对路径');
    expect(() => resolveSameOrigin('plugins\\x.json', BASE, REGISTRY_URL)).toThrow('相对路径');
    expect(() => resolveSameOrigin('../secret.json', BASE, REGISTRY_URL)).toThrow('..');
    expect(() => resolveSameOrigin('plugins/../../secret.json', BASE, REGISTRY_URL)).toThrow('..');
    expect(() => resolveSameOrigin('https://evil.example.com/x.json', BASE, REGISTRY_URL))
      .toThrow('站外');
  });

  it('拒绝 http 明文（自定义源必须 https）', () => {
    expect(() => resolveSameOrigin('x.json', 'http://example.com/', 'http://example.com/registry.json'))
      .toThrow('https');
  });
});

describe('PluginCatalogClient.fetchRegistry', () => {
  it('解析清单并按条给出 manifestUrl', async () => {
    const fetchImpl = (async () => jsonResponse({
      schemaVersion: 1,
      name: 'weiqi-assets',
      description: 'test',
      baseUrl: BASE,
      resources: [
        { id: 'ranking.total-score', type: 'plugin', name: '总分排序', summary: 's',
          pointId: 'ranking', specVersion: 1, path: 'plugins/ranking/total-score/plugin.json' },
        { id: 'web-fetch.v1', type: 'tool', name: 'web_fetch', summary: 's',
          path: 'tools/web-fetch/v1/tool.json' },
      ],
    })) as unknown as typeof fetch;

    const parsed = await new PluginCatalogClient({ fetchImpl }).fetchRegistry(REGISTRY_URL);
    expect(parsed.resources).toHaveLength(2);
    expect(parsed.resources[0]?.manifestUrl)
      .toBe('https://weiqi-dev.github.io/weiqi-assets/plugins/ranking/total-score/plugin.json');
  });

  it('schemaVersion 不是 1 直接拒', async () => {
    const fetchImpl = (async () => jsonResponse({ schemaVersion: 2, resources: [] })) as unknown as typeof fetch;
    await expect(new PluginCatalogClient({ fetchImpl }).fetchRegistry(REGISTRY_URL))
      .rejects.toThrow('schemaVersion');
  });

  it('越界路径条目被跳过，不拖垮整份清单', async () => {
    const fetchImpl = (async () => jsonResponse({
      schemaVersion: 1, baseUrl: BASE,
      resources: [
        { id: 'bad', type: 'plugin', path: '../secret.json' },
        { id: 'good', type: 'plugin', path: 'plugins/x/plugin.json' },
      ],
    })) as unknown as typeof fetch;
    const parsed = await new PluginCatalogClient({ fetchImpl }).fetchRegistry(REGISTRY_URL);
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.resources[0]?.resource.id).toBe('good');
  });
});

describe('PluginCatalogClient.fetchManifest / fetchCode', () => {
  it('manifest 与 registry 条目的 id/pointId/specVersion 必须一致', async () => {
    const manifest = {
      id: 'ranking.total-score', name: '总分排序', type: 'plugin',
      pointId: 'ranking', specVersion: 1, entry: 'rank',
      code: 'plugins/ranking/total-score/index.js', origin: 'manual', intent: 'i',
    };
    const fetchImpl = (async () => jsonResponse(manifest)) as unknown as typeof fetch;
    const client = new PluginCatalogClient({ fetchImpl });
    // 本用例只测 fetchManifest：直接构造 item 调用，不打 fetchRegistry
    const item = {
      resource: { id: 'ranking.total-score', pointId: 'ranking', specVersion: 1 },
      manifestUrl: `${BASE}plugins/ranking/total-score/plugin.json`,
      baseUrl: BASE,
    };
    const result = await client.fetchManifest(item);
    expect(result.manifest.id).toBe('ranking.total-score');
    expect(result.codeUrl).toBe(`${BASE}plugins/ranking/total-score/index.js`);

    const mismatched = { ...item, resource: { ...item.resource, pointId: 'other' } };
    await expect(client.fetchManifest(mismatched)).rejects.toThrow('pointId');
  });

  it('fetchCode 只回文本，不执行', async () => {
    const code = 'function rank(input) { return { columns: [], rows: [] }; }';
    const fetchImpl = (async () => textResponse(code)) as unknown as typeof fetch;
    await expect(new PluginCatalogClient({ fetchImpl }).fetchCode(`${BASE}index.js`))
      .resolves.toBe(code);
  });
});
