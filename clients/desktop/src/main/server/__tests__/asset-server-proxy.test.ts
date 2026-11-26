/**
 * 桌面端 /proxy 内部跟随重定向的回归测试。
 *
 * 用本地临时 http.Server 模拟上游的 302 -> 302 -> 200 链路（微信公众号文章
 * 实测就是这种形状），不写死任何带一次性票据的真实 URL。
 * AssetServer 只借它的私有 handleProxy 做请求级验证，不启动 Electron。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';

// electron / adm-zip / config / version-manager 都不是本测试要验的东西，
// 但 asset-server.ts 顶层会 import 它们；electron 的 index.js 在没有 path.txt
// 的机器上直接 require 会抛错，adm-zip 在根 node_modules 里也不存在，故先 mock。
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/weiqi-proxy-test' },
}));
vi.mock('adm-zip', () => ({ default: class AdmZip {} }));
vi.mock('../config', () => ({ AppConfig: { remoteBase: '', localPort: 8765, localHost: '127.0.0.1', localServerUrl: '' } }));
vi.mock('../version-manager', () => ({ VersionManager: class {} }));

import { AssetServer } from '../asset-server';

/** 取到私有方法做请求级调用（TS private 只是编译期限制）。 */
type ProxyServer = { handleProxy: (req: http.IncomingMessage, res: http.ServerResponse) => void };
const callProxy = (req: http.IncomingMessage, res: http.ServerResponse): void =>
  (new AssetServer() as unknown as ProxyServer).handleProxy(req, res);

let upstream: http.Server;
let upstreamBase: string;
/** 按 path 分派的上游处理器；每个用例自己设置。 */
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  upstream = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const addr = upstream.address();
  if (!addr || typeof addr === 'string') throw new Error('no upstream port');
  upstreamBase = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    upstream.close((err) => (err ? reject(err) : resolve())));
});

/** 用本地 AssetServer 的 http.Server 起一个 /proxy 路由，走 http.get 拿真实响应。 */
function requestProxy(
  target: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === undefined || !req.url.startsWith('/proxy')) {
        res.writeHead(404); res.end(); return;
      }
      callProxy(req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { server.close(); reject(new Error('no proxy port')); return; }
      const proxyUrl = `http://127.0.0.1:${addr.port}/proxy/?url=${encodeURIComponent(target)}`;
      http.get(proxyUrl, { headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode || 0, headers: res.headers, body });
        });
      }).on('error', (err) => { server.close(); reject(err); });
    });
  });
}

const FINAL_HTML = '<html><body><div id="js_content">正文在这里</div></body></html>';

describe('AssetServer.handleProxy 内部跟随重定向', () => {
  it('上游 302 -> 302 -> 200：返回最终 200 的正文与 content-type，而不是中间 302', async () => {
    handler = (req, res) => {
      if (req.url === '/article') {
        res.writeHead(302, { Location: '/mp/wappoc_appmsgcaptcha?p=1', 'Content-Type': 'text/html' });
        res.end('中间跳1');
        return;
      }
      if (req.url?.startsWith('/mp/wappoc_appmsgcaptcha')) {
        res.writeHead(302, { Location: '/article?nwr_flag=1', 'Content-Type': 'text/html' });
        res.end('中间跳2');
        return;
      }
      if (req.url?.startsWith('/article?')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(FINAL_HTML);
        return;
      }
      res.writeHead(500); res.end('unexpected path');
    };

    const { status, headers, body } = await requestProxy(`${upstreamBase}/article`);
    expect(status).toBe(200);
    expect(body).toBe(FINAL_HTML);
    expect(headers['content-type']).toBe('text/html; charset=utf-8');
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['location']).toBeUndefined();
  });

  it('相对 Location 基于当前 URL 补全（/dir/a -> b -> /dir/b）', async () => {
    const seen: string[] = [];
    handler = (req, res) => {
      seen.push(req.url || '');
      if (req.url === '/dir/a') {
        res.writeHead(302, { Location: 'b' });
        res.end();
        return;
      }
      if (req.url === '/dir/b') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('相对路径补全成功');
        return;
      }
      res.writeHead(500); res.end('unexpected path');
    };

    const { status, body } = await requestProxy(`${upstreamBase}/dir/a`);
    expect(status).toBe(200);
    expect(body).toBe('相对路径补全成功');
    expect(seen).toEqual(['/dir/a', '/dir/b']);
  });

  it('循环 / 超过跳数上限：返回明确 JSON 错误，不静默', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: '/loop' });
      res.end();
    };

    const { status, headers, body } = await requestProxy(`${upstreamBase}/loop`);
    expect(status).toBe(502);
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(body)).toEqual({
      error: 'proxy_too_many_redirects',
      detail: 'exceeded 20 redirect hops',
    });
  });

  it('3xx 缺 Location：返回明确 JSON 错误', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { 'Content-Type': 'text/html' });
      res.end('未知错误');
    };

    const { status, headers, body } = await requestProxy(`${upstreamBase}/nolocation`);
    expect(status).toBe(502);
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(body)).toEqual({
      error: 'proxy_redirect_missing_location',
      detail: 'HTTP 302 without Location',
    });
  });

  it('自定义头在每一跳都保留（x-user-agent / x-referer / x-cookie / 签名头）', async () => {
    const seen: Array<http.IncomingHttpHeaders> = [];
    handler = (req, res) => {
      seen.push({ ...req.headers });
      if (req.url === '/head') {
        res.writeHead(302, { Location: '/head-final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': 'sid=abc; Path=/' });
      res.end('ok');
    };

    const { status, headers, body } = await requestProxy(`${upstreamBase}/head`, {
      'x-user-agent': 'WeiqiApp/1.0',
      'x-referer': 'https://example.com/',
      'x-cookie': 'token=xyz',
      'content-type': 'text/plain',
      appkey: 'k1',
      accept: 'text/html',
    });
    expect(status).toBe(200);
    expect(body).toBe('ok');
    expect(headers['x-set-cookie']).toBe('sid=abc; Path=/');
    expect(seen).toHaveLength(2);
    for (const h of seen) {
      expect(h['user-agent']).toBe('WeiqiApp/1.0');
      expect(h['referer']).toBe('https://example.com/');
      expect(h['cookie']).toContain('token=xyz');
      expect(h['content-type']).toBe('text/plain');
      expect(h['appkey']).toBe('k1');
      expect(h['accept']).toBe('text/html');
    }
  });
});
