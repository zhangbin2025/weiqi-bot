/**
 * ConversationCompactor 测试
 *
 * 锁住 P3a 的六条边界：
 * 1. 触发判据 = 真的有旧消息被窗口丢掉，不是「快满了」的比例阈值；
 * 2. 摘要请求不带图片 / PDF base64，只带 describeAttachment() 文字描述；
 * 3. 上一版摘要 + 新增被丢消息一起 re-distill；
 * 4. checkpoint 每次追加、seq 递增、firstKeptIndex 是压缩边界；
 * 5. 摘要失败 / 存储失败一律静默降级（返回 null，不抛错）；
 * 6. 会话 id 含冒号时仍能生成合法 KV key；溢出识别可注入、不误判普通错误。
 *
 * 全部用 MemoryKvDriver + 假 gateway，纯 node 环境，不依赖浏览器 / 网络。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ConversationCompactor, CHAT_COMPACT_TASK, CHECKPOINT_VERSION,
  planConversationWindow,
  type ConversationCheckpoint,
} from '../ConversationCompactor';
import { CONTEXT_LIMITS } from '../ConversationPrompt';
import { KvService } from '../../skill/kv/KvService';
import { KvDomainRegistry } from '../../skill/kv/KvDomains';
import { MemoryKvDriver } from '../../skill/kv/KvDrivers';
import type { IModelGateway, ModelResult } from '../../model/IModelGateway';
import type { ConversationHistoryMessage } from '../ConversationPrompt';

function makeStore() {
  const registry = new KvDomainRegistry([{
    name: 'checkpoints',
    summary: '宿主内部 compact 检查点',
    driver: new MemoryKvDriver({ id: 'mem-cp' }),
    visibility: 'readable',
    writableBy: 'host',
    physicalPrefix: 'c.',
  }]);
  const service = new KvService(registry);
  return {
    readRaw: (domain: string, key: string) => service.readRaw(domain, key),
    put: (domain: string, key: string, value: unknown) => service.put(domain, key, value),
    service,
  };
}

function makeGateway(text = '摘要：用户偏好简洁回答，正在讨论柯洁对申真谞。') {
  return {
    isReady: vi.fn(() => true),
    execute: vi.fn().mockResolvedValue({ text, truncated: false } as ModelResult),
  } as unknown as IModelGateway & { execute: ReturnType<typeof vi.fn> };
}

function msg(role: 'user' | 'assistant', content: string, i: number): ConversationHistoryMessage & { timestamp: number } {
  return { role, content, timestamp: 1_700_000_000_000 + i };
}

/** 制造「必然丢消息」的历史：条数超过 maxMessages */
function longHistory(): Array<ConversationHistoryMessage & { timestamp: number }> {
  return Array.from({ length: CONTEXT_LIMITS.maxMessages + 6 }, (_, i) =>
    msg(i % 2 === 0 ? 'user' : 'assistant', `旧消息-${i}`, i));
}

function callsOf(gateway: ReturnType<typeof makeGateway>) {
  return gateway.execute.mock.calls.map((c) => c![0]);
}

describe('planConversationWindow', () => {
  it('短历史不丢消息，也就不触发 compact', () => {
    const plan = planConversationWindow([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀' },
    ]);
    expect(plan.dropped).toHaveLength(0);
    expect(plan.kept).toHaveLength(2);
  });

  it('超条数时 dropped 是连续最新一段之前的全部旧消息，当前句一定在 kept', () => {
    const history = longHistory();
    const plan = planConversationWindow(history);
    expect(plan.kept).toHaveLength(CONTEXT_LIMITS.maxMessages);
    expect(plan.kept[plan.kept.length - 1]!.content).toBe(`旧消息-${history.length - 1}`);
    expect(plan.dropped).toHaveLength(history.length - CONTEXT_LIMITS.maxMessages);
    expect(plan.dropped[0]!.historyIndex).toBe(0);
    // kept 与 dropped 的下标严格衔接，不挖中间
    expect(plan.dropped[plan.dropped.length - 1]!.historyIndex + 1).toBe(plan.kept[0]!.historyIndex);
  });
});

describe('ConversationCompactor.maybeCompact', () => {
  it('没有窗口丢弃时不发摘要请求、不写 checkpoint', async () => {
    const gateway = makeGateway();
    const store = makeStore();
    const compactor = new ConversationCompactor({ gateway, store });
    const cp = await compactor.maybeCompact([{ role: 'user', content: '你好' }], 'session:1:abc');
    expect(cp).toBeNull();
    expect(gateway.execute).not.toHaveBeenCalled();
    expect(await store.service.listMeta('checkpoints')).toHaveLength(0);
  });

  it('窗口丢弃 → 同步产出 checkpoint，摘要请求是纯文本旁路、任务名白名单内', async () => {
    const gateway = makeGateway();
    const store = makeStore();
    const compactor = new ConversationCompactor({ gateway, store, now: () => 42 });
    const cp = await compactor.maybeCompact(longHistory(), 'session:1:abc');

    expect(cp).not.toBeNull();
    expect(cp!.version).toBe(CHECKPOINT_VERSION);
    expect(cp!.seq).toBe(1);
    expect(cp!.reason).toBe('window-drop');
    expect(cp!.createdAt).toBe(42);
    expect(cp!.firstKeptIndex).toBe(6); // 完整历史里前 6 条被条数上限整段挤出去了
    expect(cp!.fromTs).toBe(1_700_000_000_000);
    expect(cp!.summary.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);

    const req = callsOf(gateway)[0]!;
    expect(req.task).toBe(CHAT_COMPACT_TASK);
    expect(req.options?.jsonMode).toBe(false);
    expect(req.tools).toBeUndefined();
    expect(req.messages[0]!.role).toBe('system');
    expect(JSON.stringify(req.messages)).toContain('旧消息-0');
    // checkpoint 链已追加，指针也写了；key 形状合规（会话 id 的冒号被确定性编码）
    const meta = await store.service.listMeta('checkpoints');
    expect(meta).toHaveLength(2);
    for (const m of meta) expect(m.key).toMatch(/^compact\.[a-f0-9]+\.(chain|pointer)$/);
  });

  it('第二次 compact 追加而非覆盖，seq 递增且带上上一版摘要做 re-distill', async () => {
    const gateway = makeGateway();
    // 第一次摘要 = 默认串；第二次是「合并上一版 + 新增消息」后的新版摘要
    gateway.execute
      .mockResolvedValueOnce({ text: '第一版摘要：用户偏好简洁回答', truncated: false } as ModelResult)
      .mockResolvedValueOnce({ text: '新版合并摘要', truncated: false } as ModelResult);
    const store = makeStore();
    const compactor = new ConversationCompactor({ gateway, store });
    const sid = 'session:2:xyz';

    const first = await compactor.maybeCompact(longHistory(), sid);
    // 多出 3 条新消息 → 压缩边界右移 3，新增被丢的正好是这 3 条
    const longer = [
      ...longHistory(),
      msg('user', '新增A', 100), msg('assistant', '新增B', 101), msg('user', '新增C', 102),
    ];
    const second = await compactor.maybeCompact(longer, sid);

    expect(first!.seq).toBe(1);
    expect(second!.seq).toBe(2);
    expect(second!.summary).toBe('新版合并摘要');
    expect(second!.firstKeptIndex).toBe(first!.firstKeptIndex + 3);
    const secondReq = callsOf(gateway)[1]!;
    const body = JSON.stringify(secondReq.messages);
    expect(body).toContain('上一版摘要');
    expect(body).toContain('第一版摘要：用户偏好简洁回答');
    // 增量蒸馏：新增 3 条把原 kept 最旧的 3 条挤出窗口，只喂这 3 条新被丢的；
    // 已经在第一版摘要里的旧消息-0 不重复进摘要请求。
    expect(body).toContain('旧消息-6');
    expect(body).toContain('旧消息-8');
    expect(body).not.toContain('旧消息-5');
    expect(body).not.toContain('旧消息-0');
    expect(body).not.toContain('新增A'); // 它在本轮 kept 里，不该被摘要
    const chain = await store.service.readRaw('checkpoints',
      (await store.service.listMeta('checkpoints')).find((m) => m.key.endsWith('.chain'))!.key);
    expect((chain as ConversationCheckpoint[]).map((c) => c.seq)).toEqual([1, 2]);
  });

  it('边界没右移时复用上一版 checkpoint，不追加、不再发摘要请求', async () => {
    const gateway = makeGateway();
    const store = makeStore();
    const compactor = new ConversationCompactor({ gateway, store });
    const history = longHistory();
    const first = await compactor.maybeCompact(history, 'session:2:idem');
    const second = await compactor.maybeCompact(history, 'session:2:idem');
    expect(second!.seq).toBe(first!.seq);
    expect(gateway.execute).toHaveBeenCalledTimes(1);
    const chain = await store.service.readRaw('checkpoints',
      (await store.service.listMeta('checkpoints')).find((m) => m.key.endsWith('.chain'))!.key);
    expect((chain as ConversationCheckpoint[])).toHaveLength(1);
  });

  it('摘要输入只带附件文字描述，不把图片 / PDF base64 喂给模型', async () => {
    const gateway = makeGateway();
    const compactor = new ConversationCompactor({ gateway, store: makeStore() });
    const history = longHistory();
    history[0]!.attachments = [{
      kind: 'image', mimeType: 'image/png', dataUri: 'data:image/png;base64,AAAASECRETBASE64', label: '棋谱.png',
    }];
    await compactor.maybeCompact(history, 'session:3:img');
    const body = JSON.stringify(callsOf(gateway)[0]!.messages);
    expect(body).toContain('🖼️ 棋谱.png');
    expect(body).not.toContain('AAAASECRETBASE64');
    expect(body).not.toContain('data:image/png');
  });

  it('摘要输出超长时按宿主单条上限硬截断，不引入新常量', async () => {
    const gateway = makeGateway('摘'.repeat(CONTEXT_LIMITS.maxCharsPerMessage + 500));
    const compactor = new ConversationCompactor({ gateway, store: makeStore() });
    const cp = await compactor.maybeCompact(longHistory(), 'session:4:long');
    expect(cp!.summary.length).toBe(CONTEXT_LIMITS.maxCharsPerMessage);
  });

  it('摘要失败 / 存储失败 / gateway 未就绪：一律静默返回 null，不抛错', async () => {
    const failing = makeGateway();
    failing.execute.mockRejectedValue(new Error('摘要端点挂了'));
    expect(await new ConversationCompactor({ gateway: failing, store: makeStore() })
      .maybeCompact(longHistory(), 's')).toBeNull();

    const notReady = makeGateway();
    (notReady.isReady as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(await new ConversationCompactor({ gateway: notReady })
      .maybeCompact(longHistory(), 's')).toBeNull();

    const brokenStore = {
      readRaw: vi.fn().mockRejectedValue(new Error('IndexedDB 不可用')),
      put: vi.fn().mockRejectedValue(new Error('IndexedDB 不可用')),
    };
    expect(await new ConversationCompactor({ gateway: makeGateway(), store: brokenStore })
      .maybeCompact(longHistory(), 's')).toBeNull();
  });

  it('摘要请求本身不算一次对话：不写历史、不挂工具、不进过程块（由装配方保证）', async () => {
    // 本测试锁住请求形状；ChatUseCase 集成测试另锁「不写 history / 不渲染过程块」。
    const gateway = makeGateway();
    const compactor = new ConversationCompactor({ gateway, store: makeStore() });
    await compactor.maybeCompact(longHistory(), 'session:5:shape');
    const req = callsOf(gateway)[0]!;
    expect(req.tools).toBeUndefined();
    expect(req.messages.every((m: { role: string }) => m.role === 'system' || m.role === 'user')).toBe(true);
  });
});

describe('溢出识别（P3a 保守兜底，P3b 再接 wire 精确识别）', () => {
  it('认显式上下文溢出，不误判普通超时', () => {
    const c = new ConversationCompactor({ gateway: makeGateway() });
    expect(c.isOverflowError(new Error('maximum context length exceeded'))).toBe(true);
    expect(c.isOverflowError(new Error('上下文长度超限'))).toBe(true);
    expect(c.isOverflowError(new Error('请求超时'))).toBe(false);
  });

  it('可由装配方注入精确识别器', () => {
    const c = new ConversationCompactor({
      gateway: makeGateway(),
      isOverflowError: (e) => e instanceof Error && e.message === '端点专用溢出码',
    });
    expect(c.isOverflowError(new Error('端点专用溢出码'))).toBe(true);
    expect(c.isOverflowError(new Error('maximum context length exceeded'))).toBe(false);
  });
});
