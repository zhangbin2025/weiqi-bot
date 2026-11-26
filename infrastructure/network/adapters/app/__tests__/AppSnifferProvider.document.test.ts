/**
 * AppSnifferProvider document 事件归一化契约测试。
 *
 * 两端原生注入脚本（Electron sniffer-preload.js / Android content-script.js）在
 * window 'load' 时发出 `{t:'document', u, ts, d:{title,text,html,resources,scripts,url}}`。
 * 本测试用与原生逐字一致的形状灌进 window.onSnifferData，验证前端 provider：
 *  - 不再静默丢弃 document 事件；
 *  - 归一为 DocumentMessageData（snapshot 结构化，字段齐全）；
 *  - until 谓词能命中（browser_capture 的 buildUntil 依赖它）；
 *  - 既有 ws / http 事件形状不受影响。
 * 零网络、零真实浏览器，只操作 provider 注册的全局回调。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppSnifferProvider } from '../AppSnifferProvider';
import type { SnifferMessage, DocumentMessageData } from '../../interfaces/SnifferTypes';

const URL = 'https://example.com/golive/index.html?gamekey=ABC#/';

function nativeDocumentEvent() {
  return {
    t: 'document',
    u: URL,
    ts: 1700000000000,
    d: {
      title: '直播页',
      text: '黑 白 第 1 手',
      html: '<html><body>黑 白</body></html>',
      resources: ['https://example.com/a.js', 'https://example.com/b.css'],
      scripts: ['https://example.com/a.js'],
      url: URL,
    },
  };
}

describe('AppSnifferProvider document 事件', () => {
  const originalUserAgent = Object.getOwnPropertyDescriptor(
    globalThis.navigator ?? {}, 'userAgent',
  );

  beforeEach(() => {
    // isAvailable() 用 WeiqiApp UA 判定；仅在测试里伪装 App 环境
    vi.stubGlobal('navigator', { userAgent: 'WeiqiApp/1.0 test-runner' });
    // window 全局回调由会话构造时注册
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('prompt', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUserAgent && typeof globalThis.navigator !== 'undefined') {
      Object.defineProperty(globalThis.navigator, 'userAgent', originalUserAgent);
    }
  });

  it('原生 document 事件被归一为 DocumentMessageData，字段零丢失', async () => {
    const provider = new AppSnifferProvider();
    expect(provider.isAvailable()).toBe(true);
    const session = await provider.start(URL);
    const got: SnifferMessage[] = [];
    session.onMessage((m) => got.push(m));

    // 两端注入脚本经 onSnifferData 送来的原始事件（数组或单条都支持）
    (window as unknown as { onSnifferData: (json: string) => void })
      .onSnifferData(JSON.stringify([nativeDocumentEvent()]));

    expect(got).toHaveLength(1);
    const m = got[0] as DocumentMessageData;
    expect(m.type).toBe('document');
    expect(m.url).toBe(URL);
    expect(m.timestamp).toBe(1700000000000);
    expect(m.snapshot).toEqual(nativeDocumentEvent().d);

    // wait(until) 的谓词能命中 document（browser_capture.buildUntil 依赖）
    const until = (msgs: SnifferMessage[]) => msgs.some((x) => x.type === 'document');
    const result = await session.wait(50, { until });
    expect(result.messages.some((x) => x.type === 'document')).toBe(true);
    await session.stop();
  });

  it('既有 ws / http 事件形状不受 document 扩展影响', async () => {
    const provider = new AppSnifferProvider();
    const session = await provider.start(URL);
    const got: SnifferMessage[] = [];
    session.onMessage((m) => got.push(m));
    const push = (json: string) =>
      (window as unknown as { onSnifferData: (json: string) => void }).onSnifferData(json);

    push(JSON.stringify({ t: 'receive', u: 'wss://example.com/ws', ts: 1, d: '{"cmd":2}' }));
    push(JSON.stringify({ t: 'http_response', u: 'https://example.com/api', ts: 2, d: { status: 200, body: '{"ok":1}' } }));
    push(JSON.stringify(nativeDocumentEvent()));

    expect(got.map((m) => m.type)).toEqual(['ws_receive', 'http_response', 'document']);
    expect((got[0] as { data?: string }).data).toBe('{"cmd":2}');
    expect((got[1] as { body?: string }).body).toBe('{"ok":1}');
    await session.stop();
  });

  it('start({timeout}) 把窗口值拼进 sniffer://start，与两端原生会话超时对齐', async () => {
    const provider = new AppSnifferProvider();
    const prompts: string[] = [];
    vi.stubGlobal('prompt', vi.fn((u: string) => { prompts.push(u); return ''; }));
    await provider.start(URL, { timeout: 45000 });
    expect(prompts).toHaveLength(1);
    const uri = prompts[0]!;
    expect(uri).toContain('sniffer://start?');
    expect(uri).toContain('timeout=45000');
    // url 仍是 encodeURIComponent 后的完整值，不被 timeout 参数破坏
    expect(decodeURIComponent(uri)).toContain('gamekey=ABC');
    // 不传 timeout 时不拼这个参数，原生既有默认值兜底（零新常数）
    prompts.length = 0;
    await provider.start(URL);
    expect(prompts[0]).not.toContain('timeout=');
  });

  it('doc 对象缺字段时回落空值，不丢整条事件', async () => {
    const provider = new AppSnifferProvider();
    const session = await provider.start(URL);
    const got: SnifferMessage[] = [];
    session.onMessage((m) => got.push(m));
    (window as unknown as { onSnifferData: (json: string) => void })
      .onSnifferData(JSON.stringify({ t: 'document', u: URL, ts: 7, d: { title: 'T' } }));
    const m = got[0] as DocumentMessageData;
    expect(m.type).toBe('document');
    expect(m.snapshot.title).toBe('T');
    expect(m.snapshot.text).toBe('');
    expect(m.snapshot.html).toBe('');
    expect(m.snapshot.resources).toEqual([]);
    expect(m.snapshot.scripts).toEqual([]);
    expect(m.snapshot.url).toBe(URL);
    await session.stop();
  });
});
