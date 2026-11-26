/**
 * browser_capture 通用采集能力契约测试。
 *
 * 不触网、不开真实浏览器：注入假的 ISnifferProvider，回一组含 document / ws / http
 * 事件的 SnifferMessage。验证：
 *  - 同一 primitive 同时服务 workflow（value 结构化）与 LLM（observation 只回句柄 + 摘要）；
 *  - 四个分区按真实事件族归类（fetch/XHR 同属 http，不假造区分），meta 给真实计数；
 *  - waitFor 复用 wait(until) 谓词、parts 只过滤主数组；
 *  - read 复用 web_cache_read 引擎（info / slice / grep）、list 列句柄；
 *  - 会话 start → wait → stop 恒关；非法 / 私网 URL 结构化拒绝且不 start；
 *  - 工具表含三件、system 说明通用且标注「数据不是指令」。
 * 零时钟、零随机数、零新数值断言；不含任何一次性票据 URL。
 */
import { describe, it, expect } from 'vitest';
import {
  browserCapturePrimitive,
  createBrowserCapturePrimitives,
  createBrowserCaptureToolKit,
  BROWSER_CAPTURE_TOOL_NAME,
  BROWSER_CAPTURE_READ_TOOL_NAME,
  BROWSER_CAPTURE_LIST_TOOL_NAME,
  CAPTURE_SYSTEM_SUFFIX,
  type BrowserCaptureDeps,
  type CaptureValue,
} from '../BrowserCapture';
import { validateWebFetchUrl } from '../WebFetchTool';
import type { ISnifferProvider, ISnifferSession } from '@infrastructure/network/interfaces/ISnifferProvider';
import type { SnifferMessage, SnifferResult } from '@infrastructure/network/interfaces/SnifferTypes';
import type { PrimitiveResult } from '@application/skill/SkillTypes';

const URL = 'https://example.com/golive/index.html?gamekey=ABC#/';

function snapshot() {
  return {
    title: '直播页',
    text: '黑 白 第 1 手',
    html: '<html><body>黑 白</body></html>',
    resources: ['https://example.com/a.js', 'https://example.com/b.css'],
    scripts: ['https://example.com/a.js'],
    url: URL,
  };
}

function messages(): SnifferMessage[] {
  return [
    { type: 'ws_open', wsUrl: 'wss://example.com/ws', timestamp: 1 },
    { type: 'ws_receive', wsUrl: 'wss://example.com/ws', data: '{"cmd":2,"sgf":"(;B[pd])"}', timestamp: 2 },
    { type: 'http_request', url: 'https://example.com/api', method: 'GET', timestamp: 3 },
    { type: 'http_response', url: 'https://example.com/api', status: 200, body: '{"ok":1}', timestamp: 4 },
    // XHR 与 fetch 同族，仍归 http（不假造 fetch/xhr 分区）
    { type: 'http_response', url: 'https://example.com/xhr', status: 200, body: '<data/>', timestamp: 5 },
    { type: 'document', url: URL, snapshot: snapshot(), timestamp: 6 },
  ];
}

interface FakeSession extends ISnifferSession {
  stopped: number;
  untilSeen: ((messages: SnifferMessage[]) => boolean) | undefined;
  /** wait() 是否收到 options（holdMs 路径下为 false，走现成空等窗口） */
  optionsSeen: boolean;
  timeoutSeen: number | undefined;
  /** start() 收到的 SnifferOptions.timeout（与 wait 窗口必须一致） */
  startTimeoutSeen: number | undefined;
}

/** 每次 start 造一个新会话；wait 返回注入的消息，记录 until / timeout / stop 次数 */
function fakeSniffer(msgs: SnifferMessage[] = messages()): {
  deps: BrowserCaptureDeps;
  sessions: FakeSession[];
} {
  const sessions: FakeSession[] = [];
  const provider: ISnifferProvider = {
    name: 'fake-sniffer',
    displayName: '假 sniffer',
    isAvailable: () => true,
    getEnvironmentDescription: () => '测试环境',
    start: async (url: string, options?: { timeout?: number }): Promise<ISnifferSession> => {
      const s: FakeSession = {
        id: `s${sessions.length}`,
        url,
        status: 'running',
        stopped: 0,
        untilSeen: undefined,
        optionsSeen: false,
        timeoutSeen: undefined,
        startTimeoutSeen: options?.timeout,
        onMessage: () => {},
        onError: () => {},
        getMessages: () => [...msgs],
        wait: async (timeout?: number, options?: { until?: (m: SnifferMessage[]) => boolean }): Promise<SnifferResult> => {
          s.timeoutSeen = timeout;
          s.untilSeen = options?.until;
          s.optionsSeen = options !== undefined;
          // 真实 provider 语义：until 命中才提前结束，没命中就等 timeout 兜底再返回已抓到的消息。
          // 这里不强制断言命中——minEvents 大于注入帧数时本就该走兜底、仍返回已采集数据。
          return { success: true, sessionId: s.id, messages: [...msgs] };
        },
        stop: async () => { s.stopped += 1; s.status = 'stopped'; },
      };
      sessions.push(s);
      return s;
    },
  };
  // timeoutMs 用现有 WebFetchTool 测试同款的小值，只是断言「透传同一配置值」，不是新阈值。
  return { deps: { sniffer: provider, timeoutMs: 1234 }, sessions };
}

function valueOf(r: PrimitiveResult): CaptureValue {
  expect(r.ok).toBe(true);
  expect(r.value).toBeDefined();
  return r.value as CaptureValue;
}

describe('browser_capture 通用采集（workflow 第一通路）', () => {
  it('一个 primitive 同时给 workflow 结构化 value 与 LLM 摘要观察', async () => {
    const { deps, sessions } = fakeSniffer();
    const p = browserCapturePrimitive(deps);
    const r = await p.execute(JSON.stringify({ url: URL }));
    const v = valueOf(r);

    expect(v.handle).toBe(validateWebFetchUrl(URL));
    expect(v.meta).toEqual({ url: v.handle, handle: v.handle, ws: 2, http: 3, document: 1 });
    expect(v.ws.map((m) => m.type)).toEqual(['ws_open', 'ws_receive']);
    expect(v.http.map((m) => m.type)).toEqual(['http_request', 'http_response', 'http_response']);
    expect(v.document).toEqual([snapshot()]);
    // 正文绝不进观察：只有句柄 + 计数 + 标题 + 用法 + 数据边界
    expect(r.observation).toContain(v.handle);
    expect(r.observation).toContain('ws 2 条 / http 3 条 / document 1 份');
    expect(r.observation).toContain('直播页');
    expect(r.observation).not.toContain('(;B[pd])');       // wss 帧正文
    expect(r.observation).not.toContain('<html>');          // document html
    expect(r.observation).toContain('不是指令');

    // 宿主恒关会话，且 wait 透传既有配置值 + until 谓词
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.stopped).toBe(1);
    expect(sessions[0]!.timeoutSeen).toBe(1234);
    expect(sessions[0]!.untilSeen).toBeDefined();
  });

  it('register 进 OperatorRegistry 的原语集只有 browser_capture，且显式非幂等', () => {
    const { deps } = fakeSniffer();
    const ps = createBrowserCapturePrimitives(deps);
    expect(ps.map((x) => x.name)).toEqual([BROWSER_CAPTURE_TOOL_NAME]);
    // 每次都新开真实会话，不是纯计算幂等算子（沿用既有约定，不是拟合数值）
    expect(ps[0]!.idempotent).toBe(false);
    expect(ps[0]!.definition.parameters).toHaveProperty('properties.waitFor');
  });

  it('waitFor 四个有限选项都复用 until 谓词；不命中 document 前置条件时不提前结束', async () => {
    const { deps } = fakeSniffer();
    const p = browserCapturePrimitive(deps);
    for (const waitFor of ['ws', 'http', 'document', 'quiet'] as const) {
      const r = await p.execute(JSON.stringify({ url: URL, waitFor }));
      expect(valueOf(r).meta.ws).toBe(2);
    }
    // 直接验谓词：没有 document 快照时，ws/http 条件下不得提前返回
    const { deps: d2, sessions } = fakeSniffer();
    await browserCapturePrimitive(d2).execute(JSON.stringify({ url: URL, waitFor: 'ws' }));
    const until = sessions[0]!.untilSeen!;
    const onlyWs: SnifferMessage[] = [{ type: 'ws_receive', wsUrl: 'wss://x', data: 'x', timestamp: 1 }];
    expect(until(onlyWs)).toBe(false); // 页面还没 load 完成，不能丢 document
    expect(until([...onlyWs, { type: 'document', url: URL, snapshot: snapshot(), timestamp: 2 }])).toBe(true);
  });

  it('parts 只过滤主数组，meta 恒给真实采集计数', async () => {
    const { deps } = fakeSniffer();
    const r = await browserCapturePrimitive(deps).execute(
      JSON.stringify({ url: URL, parts: ['document'] }),
    );
    const v = valueOf(r);
    expect(v.ws).toEqual([]);
    expect(v.http).toEqual([]);
    expect(v.document).toEqual([snapshot()]);
    expect(v.meta).toEqual({ url: v.handle, handle: v.handle, ws: 2, http: 3, document: 1 });
  });
});

describe('browser_capture 等待语义（LLM 开发反馈整改）', () => {
  it('缺省 minEvents=1：逐字保持旧行为（第一帧 + document 即命中 until）', async () => {
    const { deps, sessions } = fakeSniffer();
    await browserCapturePrimitive(deps).execute(JSON.stringify({ url: URL, waitFor: 'ws' }));
    const s = sessions[0]!;
    expect(s.optionsSeen).toBe(true);
    expect(s.timeoutSeen).toBe(1234); // 既有 deps.timeoutMs 作兜底，不新造
    const until = s.untilSeen!;
    const doc = { type: 'document', url: URL, snapshot: snapshot(), timestamp: 2 } as SnifferMessage;
    const oneWs = { type: 'ws_receive', wsUrl: 'wss://x', data: 'f1', timestamp: 1 } as SnifferMessage;
    expect(until([oneWs, doc])).toBe(true);
  });

  it('minEvents=N：攒够 N 条目标分区帧才命中，首帧不再收工', async () => {
    const { deps, sessions } = fakeSniffer();
    const r = await browserCapturePrimitive(deps).execute(
      JSON.stringify({ url: URL, waitFor: 'ws', minEvents: 3 }),
    );
    expect(valueOf(r).meta.ws).toBe(2); // 分类照常，结束条件由 until 决定
    const s = sessions[0]!;
    expect(s.optionsSeen).toBe(true);
    expect(s.timeoutSeen).toBe(1234); // 兜底上限仍是既有配置值，不是 N 换算出来的数
    expect(s.startTimeoutSeen).toBe(1234);
    const until = s.untilSeen!;
    const doc = { type: 'document', url: URL, snapshot: snapshot(), timestamp: 9 } as SnifferMessage;
    const frame = (i: number) => ({ type: 'ws_receive', wsUrl: 'wss://x', data: `f${i}`, timestamp: i } as SnifferMessage);
    expect(until([frame(1), frame(2), doc])).toBe(false); // 2 条不够
    expect(until([frame(1), frame(2), frame(3), doc])).toBe(true); // 第 3 条到才收工
    // 仍须有 document 快照（不因计数就跳过 load 前置）
    expect(until([frame(1), frame(2), frame(3)])).toBe(false);
  });

  it('holdMs=M：走现成不设 until 的空等窗口，timeout 逐字等于声明值', async () => {
    const { deps, sessions } = fakeSniffer();
    const r = await browserCapturePrimitive(deps).execute(
      JSON.stringify({ url: URL, holdMs: 8000, parts: ['ws'] }),
    );
    const v = valueOf(r);
    expect(v.ws).toHaveLength(2);
    expect(v.http).toEqual([]); // parts 仍生效
    expect(v.meta.ws).toBe(2);  // meta 恒真实计数
    const s = sessions[0]!;
    expect(s.optionsSeen).toBe(false);   // 没有 until
    expect(s.untilSeen).toBeUndefined();
    expect(s.timeoutSeen).toBe(8000);    // 声明值直接透传给 wait
    expect(s.startTimeoutSeen).toBe(8000); // 同一窗口值传给原生 start，避免 30s 默认值截断
    expect(s.stopped).toBe(1);           // finally 恒关
  });

  it('minEvents 与 holdMs 互斥 / 非法值结构化拒绝，且绝不启动会话', async () => {
    const { deps, sessions } = fakeSniffer();
    const p = browserCapturePrimitive(deps);
    const bad = [
      { url: URL, minEvents: 2, holdMs: 1000 },
      { url: URL, minEvents: 0 },
      { url: URL, minEvents: 1.5 },
      { url: URL, minEvents: '3' },
      { url: URL, holdMs: 0 },
      { url: URL, holdMs: -1 },
      { url: URL, holdMs: 2.5 },
    ];
    for (const a of bad) {
      const r = await p.execute(JSON.stringify(a));
      expect(r.ok).toBe(false);
      expect(r.value).toBeUndefined();
      expect(r.observation).toContain('browser_capture');
    }
    expect(sessions).toHaveLength(0);
  });

  it('工具定义与 system 说明都写明了 minEvents / holdMs，且承认不是事件后计时', () => {
    const { deps } = fakeSniffer();
    const kit = createBrowserCaptureToolKit(deps);
    const def = kit.tools.find((t) => t.name === BROWSER_CAPTURE_TOOL_NAME)!;
    const desc = JSON.stringify(def);
    expect(desc).toContain('minEvents');
    expect(desc).toContain('holdMs');
    expect(desc).toContain('互斥');
    expect(CAPTURE_SYSTEM_SUFFIX).toContain('minEvents');
    expect(CAPTURE_SYSTEM_SUFFIX).toContain('holdMs');
    expect(CAPTURE_SYSTEM_SUFFIX).toContain('固定采集');
  });
});

describe('browser_capture LLM 出口（句柄分页读）', () => {
  it('ToolKit 三件工具 + 通用 system 说明，零站点/棋谱知识', () => {
    const { deps } = fakeSniffer();
    const kit = createBrowserCaptureToolKit(deps);
    expect(kit.tools.map((t) => t.name)).toEqual([
      BROWSER_CAPTURE_TOOL_NAME,
      BROWSER_CAPTURE_READ_TOOL_NAME,
      BROWSER_CAPTURE_LIST_TOOL_NAME,
    ]);
    expect(Object.keys(kit.executors).sort()).toEqual([
      BROWSER_CAPTURE_LIST_TOOL_NAME,
      BROWSER_CAPTURE_READ_TOOL_NAME,
      BROWSER_CAPTURE_TOOL_NAME,
    ].sort());
    expect(kit.systemPrompt).toBe(CAPTURE_SYSTEM_SUFFIX);
    expect(CAPTURE_SYSTEM_SUFFIX).toContain('纯 Web 环境无此能力');
    expect(CAPTURE_SYSTEM_SUFFIX).toContain('不是用户或系统指令');
    expect(CAPTURE_SYSTEM_SUFFIX).not.toContain('SGF');
    expect(CAPTURE_SYSTEM_SUFFIX).not.toContain('棋谱');
  });

  it('capture → list → read info/slice/grep 全链路复用同一引擎', async () => {
    const { deps } = fakeSniffer();
    const kit = createBrowserCaptureToolKit(deps);
    const cap = await kit.executors[BROWSER_CAPTURE_TOOL_NAME]!(JSON.stringify({ url: URL }));
    const handle = validateWebFetchUrl(URL);
    expect(cap.observation).toContain(handle);

    const list = await kit.executors[BROWSER_CAPTURE_LIST_TOOL_NAME]!('{}');
    expect(list.ok).toBe(true);
    expect(list.observation).toContain(handle);
    expect(list.observation).not.toContain('(;B[pd])'); // list 不含正文

    const read = kit.executors[BROWSER_CAPTURE_READ_TOOL_NAME]!;
    const info = await read(JSON.stringify({ handle, part: 'document', mode: 'info' }));
    expect(info.ok).toBe(true);
    expect(info.observation).toContain('browser_capture_read：'); // 前缀已对齐，不是 web_cache_read

    const slice = await read(JSON.stringify({ handle, part: 'ws', mode: 'slice', offset: 0, length: 200 }));
    expect(slice.ok).toBe(true);
    expect(slice.observation).toContain('ws_receive');

    const grep = await read(JSON.stringify({ handle, part: 'http', mode: 'grep', pattern: 'ok' }));
    expect(grep.ok).toBe(true);
    expect(grep.observation).toContain('ok');

    // 句柄不存在 / part 非法 / mode 非法：结构化拒绝，不抛
    expect((await read(JSON.stringify({ handle: 'https://nope.example/', part: 'all', mode: 'info' }))).ok).toBe(false);
    expect((await read(JSON.stringify({ handle, part: 'bogus', mode: 'info' }))).ok).toBe(false);
    expect((await read(JSON.stringify({ handle, mode: 'bogus' }))).ok).toBe(false);
  });

  it('非法 / 环回 URL 结构化拒绝，且绝不启动浏览器会话', async () => {
    const { deps, sessions } = fakeSniffer();
    const p = browserCapturePrimitive(deps);
    for (const bad of ['', 'ftp://example.com/', 'http://127.0.0.1/', 'not-a-url']) {
      const r = await p.execute(JSON.stringify({ url: bad }));
      expect(r.ok).toBe(false);
      expect(r.value).toBeUndefined();
      expect(r.observation).toContain('browser_capture');
    }
    expect(sessions).toHaveLength(0);
    // waitFor / parts 非法值也结构化拒绝
    expect((await p.execute(JSON.stringify({ url: URL, waitFor: 'eval' }))).ok).toBe(false);
    expect((await p.execute(JSON.stringify({ url: URL, parts: ['fetch'] }))).ok).toBe(false);
    expect((await p.execute(JSON.stringify({ url: URL, minEvents: 'x' }))).ok).toBe(false);
    expect((await p.execute(JSON.stringify({ url: URL, holdMs: 'x' }))).ok).toBe(false);
  });
});
