/**
 * Skill 本地数据层框架契约测试
 *
 * 锁住四条用户明确要求的边界：
 * 1. 域隔离：模型只能给逻辑域名，物理键由宿主写死；畸形 key 一律拒绝。
 * 2. 敏感数据（不止密钥）：opaque 域任何模型可见操作都不回显值，且模型不能写 / 删；
 *    宿主专用 readRaw / put 仍可用（供面板 / P2 直连消费）。
 * 3. 大值分页：checkpoint 这类大对象按 kv_slice 分页读，观察不超宿主具名常量，
 *    尾部明确提示未到末尾 —— 不凭预览编造。
 * 4. **扩展不改内核**：新加一个声明 'query' 能力的驱动 + 一条域，工具集自动多出
 *    kv_query、且能正确执行；KvService / 装配 / 既有工具签名一行未动。
 *
 * 用 MemoryKvDriver 覆盖全部策略分支（与 LocalStorage / IndexedDB 驱动行为逐字一致），
 * 不依赖 fake-indexeddb / happy-dom，纯 node 环境即可跑。
 */
import { describe, it, expect } from 'vitest';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import { KvService } from '../KvService';
import { KvDomainRegistry } from '../KvDomains';
import { MemoryKvDriver } from '../KvDrivers';
import { createKvPrimitives, buildKvSystemSuffix } from '../KvPrimitives';
import { KV_TOOL_NAMES } from '../KvTypes';
import type { KvDomainDescriptor, KvCapability, KvArgs, KvOutcome, KvStoredValue } from '../KvTypes';

/** 三个域全用内存驱动，形状与默认域一致，便于断言策略而非后端 */
function makeRegistry(domains?: KvDomainDescriptor[]): KvDomainRegistry {
  return new KvDomainRegistry(domains ?? [
    {
      name: 'prefs', summary: '偏好', driver: new MemoryKvDriver({ id: 'mem-prefs' }),
      visibility: 'readable', writableBy: 'model', physicalPrefix: 'p.',
      limits: { maxValueChars: CONTEXT_LIMITS.maxCharsPerMessage },
    },
    {
      name: 'secrets', summary: '敏感', driver: new MemoryKvDriver({ id: 'mem-secrets' }),
      visibility: 'opaque', writableBy: 'host', physicalPrefix: 's.',
    },
    {
      name: 'checkpoints', summary: '检查点', driver: new MemoryKvDriver({ id: 'mem-cp' }),
      visibility: 'readable', writableBy: 'model', physicalPrefix: 'c.',
    },
  ]);
}

function makeService(domains?: KvDomainDescriptor[]): KvService {
  return new KvService(makeRegistry(domains));
}

async function call(service: KvService, cap: KvCapability, args: KvArgs): Promise<KvOutcome> {
  return service.execute(cap, args);
}

describe('域隔离与参数校验', () => {
  it('未知域 / 缺域 / 畸形 key 一律拒绝，且不接受物理键玩法', async () => {
    const s = makeService();
    expect((await call(s, 'read', { domain: 'nope', key: 'x' })).ok).toBe(false);
    expect((await call(s, 'read', { key: 'x' })).ok).toBe(false);
    for (const bad of ['../escape', 'a:b', '', 'x'.repeat(129)]) {
      const r = await call(s, 'read', { domain: 'prefs', key: bad });
      expect(r.ok).toBe(false);
    }
  });

  it('两个域同键互不可见（物理前缀隔离）', async () => {
    const s = makeService();
    await call(s, 'write', { domain: 'prefs', key: 'watchlist', value: ['000001'] });
    const r = await call(s, 'read', { domain: 'checkpoints', key: 'watchlist' });
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('不存在');
  });

  it('value 不可序列化（循环引用 / undefined）时不落库', async () => {
    const s = makeService();
    const cyclic: Record<string, unknown> = {}; cyclic['self'] = cyclic;
    expect((await call(s, 'write', { domain: 'prefs', key: 'bad', value: cyclic })).ok).toBe(false);
    expect((await call(s, 'write', { domain: 'prefs', key: 'bad', value: undefined })).ok).toBe(false);
  });
});

describe('敏感数据域（通用策略，不限密钥）', () => {
  it('面板可写明文，模型任何可见操作都读不到值', async () => {
    const s = makeService();
    expect((await s.put('secrets', 'apiKey', 'sk-very-secret')).ok).toBe(true);

    const read = await call(s, 'read', { domain: 'secrets', key: 'apiKey' });
    expect(read.observation).not.toContain('sk-very-secret');
    expect(read.observation).toContain('不回显');

    const slice = await call(s, 'slice', { domain: 'secrets', key: 'apiKey', offset: 0 });
    expect(slice.observation).not.toContain('sk-very-secret');
    expect(slice.observation).toContain('敏感域');

    const list = await call(s, 'list', { domain: 'secrets' });
    expect(list.observation).not.toContain('sk-very-secret');
    expect(list.observation).toContain('apiKey'); // 只回键名与元信息
  });

  it('模型不能写 / 删敏感域，也不能借别的域绕过', async () => {
    const s = makeService();
    const w = await call(s, 'write', { domain: 'secrets', key: 'token', value: 'abc' });
    expect(w.ok).toBe(false);
    expect(w.observation).toContain('设置面板');
    expect((await call(s, 'remove', { domain: 'secrets', key: 'token' })).ok).toBe(false);
    expect(await s.readRaw('secrets', 'token')).toBeNull();
  });

  it('宿主专用 readRaw / put / remove / listMeta 可消费敏感值（不经过模型）', async () => {
    const s = makeService();
    await s.put('secrets', 'cred', { key: 'xyz', scope: 'news' });
    expect(await s.readRaw('secrets', 'cred')).toEqual({ key: 'xyz', scope: 'news' });
    const meta = await s.listMeta('secrets');
    expect(meta.map((m) => m.key)).toContain('cred');
    expect(meta[0]!.key).not.toContain('s.'); // 面板看到的是逻辑键，不是物理键
    await s.remove('secrets', 'cred');
    expect(await s.readRaw('secrets', 'cred')).toBeNull();
  });
});

describe('偏好读写与大值分页', () => {
  it('自选股一次保存、之后直接读回，不需要用户每轮重列', async () => {
    const s = makeService();
    const stocks = [{ code: '000001', name: '平安银行' }, { code: '600519', name: '贵州茅台' }];
    expect((await call(s, 'write', { domain: 'prefs', key: 'watchlist', value: stocks })).ok).toBe(true);
    const r = await call(s, 'read', { domain: 'prefs', key: 'watchlist' });
    expect(r.observation).toContain('600519');
    expect(r.preparatory).toBe(true); // 只读准备动作不占自主决策预算
  });

  it('超该域声明的单条上限时拒绝并如实回执，不谎报已保存', async () => {
    const s = makeService();
    const big = 'x'.repeat(CONTEXT_LIMITS.maxCharsPerMessage + 10);
    const r = await call(s, 'write', { domain: 'prefs', key: 'tooBig', value: big });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('上限');
    expect(await s.readRaw('prefs', 'tooBig')).toBeNull();
  });

  it('checkpoint 大对象用 slice 分页读，观察不超宿主上限且提示继续翻页', async () => {
    const s = makeService();
    // 正文长度取「单条上限 × 3」，保证任何常量取值下都必然跨片（不写死旧值）。
    const longText = '摘要'.repeat(CONTEXT_LIMITS.maxCharsPerMessage * 3 / 2);
    await s.put('checkpoints', 'session-1', { summary: longText });
    const first = await call(s, 'slice', { domain: 'checkpoints', key: 'session-1', offset: 0 });
    expect(first.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
    expect(first.observation).toContain('未到末尾');
    expect(first.observation).toContain('摘要');
    // 第二片起点由第一片 detail 里的 [start,end) 推导，不写死数值
    const end = Number(/\[\d+,(\d+)\)/.exec(first.detail)![1]);
    expect(end).toBeGreaterThan(0);
    const second = await call(s, 'slice', { domain: 'checkpoints', key: 'session-1', offset: end });
    expect(second.detail).toContain(`[${end},`);
  });
});

describe('扩展不改内核', () => {
  it('新驱动声明 query 能力 + 注册新域 → 工具集自动多出 kv_query 且可执行', async () => {
    // 模拟「以后加全文检索」：只写一个驱动 + 一条域，KvService / 装配 / 既有工具签名都不动
    const searchDriver = new MemoryKvDriver({
      id: 'mem-search',
      extraCapabilities: ['query'],
      invokeImpl: async (capability, prefix, args, entries) => {
        expect(capability).toBe('query');
        const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '';
        const hits = [...entries.keys()]
          .filter((k) => k.startsWith(prefix) && k.includes(pattern))
          .map((k) => ({ key: k, snippet: '(命中片段)' }));
        return { observation: `命中 ${hits.length} 条：${hits.map((h) => h.key).join('、')}`, ok: true, detail: '检索完成' };
      },
    });
    const s = makeService([
      {
        name: 'prefs', summary: '偏好', driver: new MemoryKvDriver({ id: 'mem-prefs2' }),
        visibility: 'readable', writableBy: 'model', physicalPrefix: 'p.',
      },
      {
        name: 'search', summary: '检索', driver: searchDriver,
        visibility: 'readable', writableBy: 'model', physicalPrefix: 'q.',
      },
    ]);

    // 工具集按能力并集动态生成：kv_query 自动出现
    const names = createKvPrimitives(s).map((p) => p.name);
    expect(names).toContain(KV_TOOL_NAMES.query);
    expect(names).toContain(KV_TOOL_NAMES.read); // 既有能力不受影响

    // 内核对非基础能力一律委派，没有 per-capability 分支
    const r = await call(s, 'query', { domain: 'search', pattern: 'alpha' });
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('命中');
  });

  it('敏感域跑扩展能力时也不回显命中内容', async () => {
    const searchDriver = new MemoryKvDriver({
      id: 'mem-secret-search',
      extraCapabilities: ['query'],
      invokeImpl: async () => ({
        observation: '命中：sk-very-secret 出现在某处', ok: true, detail: '检索完成',
      }),
    });
    const s = makeService([{
      name: 'secrets', summary: '敏感', driver: searchDriver,
      visibility: 'opaque', writableBy: 'host', physicalPrefix: 's.',
    }]);
    const r = await call(s, 'query', { domain: 'secrets', pattern: 'sk' });
    expect(r.observation).not.toContain('sk-very-secret');
    expect(r.observation).toContain('不回显');
  });

  it('驱动声明了能力却没实现 invoke → 明确回「未实现」，不静默成功', async () => {
    const bare = new MemoryKvDriver({ id: 'bare', extraCapabilities: ['query'] });
    const s = makeService([{
      name: 'search', summary: '检索', driver: bare,
      visibility: 'readable', writableBy: 'model', physicalPrefix: 'q.',
    }]);
    const r = await call(s, 'query', { domain: 'search', pattern: 'x' });
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('未实现');
  });

  it('域注册表拒绝重名 / 非法域名（装配期失败，不静默）', () => {
    expect(() => new KvDomainRegistry([
      { name: 'prefs', summary: '', driver: new MemoryKvDriver(), visibility: 'readable', writableBy: 'model', physicalPrefix: 'p.' },
      { name: 'prefs', summary: '', driver: new MemoryKvDriver(), visibility: 'readable', writableBy: 'model', physicalPrefix: 'q.' },
    ])).toThrow(/重复/);
    expect(() => new KvDomainRegistry([
      { name: '../evil', summary: '', driver: new MemoryKvDriver(), visibility: 'readable', writableBy: 'model', physicalPrefix: 'p.' },
    ])).toThrow(/不合法/);
  });

  it('MemoryKvDriver 与驱动契约一致：坏形状按不存在处理', async () => {
    const d = new MemoryKvDriver();
    await d.set('p.bad', { value: undefined, updatedAt: 1, size: 0 } as unknown as KvStoredValue);
    // 驱动本身只存不校验；内核的 parseStored 口径在 LocalStorage 驱动里，
    // 这里锁住的是 list 只回元信息、不把 value 带出来
    const metas = await d.list('p.');
    expect(metas[0]!.key).toBe('p.bad');
    expect(metas[0]).not.toHaveProperty('value');
  });
});

/**
 * 2026-11-19 用户实测：模型「没让看自选却每轮先读 prefs」。根因之一是 system 后缀把
 * 「读偏好」写成命中技能时的默认动作。收窄后锁住两条边界：
 * - 不再把读偏好描述成每轮 / 每个技能的默认第一步；
 * - 明确「用户已指定查询对象时直接查、不先读偏好」，与 weather.wttr / stock.quote 配方一致。
 */
describe('kv systemSuffix 不诱导每轮读偏好', () => {
  it('后缀明确「仅在配方要求 / 用户提到自选偏好时才读」，且指定输入不先读偏好', () => {
    const suffix = buildKvSystemSuffix(makeService());
    // 仍讲清机制与边界
    expect(suffix).toContain('本地数据层');
    expect(suffix).toContain('kv_write');
    expect(suffix).toContain('敏感域');
    // 收窄后的关键措辞
    expect(suffix).toContain('仅在配方明确要求');
    expect(suffix).toContain('才用 kv_read');
    expect(suffix).toContain('不要先读偏好');
    expect(suffix).toContain('直接按该输入查询');
    // 旧措辞（把读偏好写成命中技能时的默认动作）不得回来
    expect(suffix).not.toContain('命中相关技能时先用 kv_read 取');
    expect(suffix).not.toContain('不要让用户每次重新列一遍');
  });

  it('后缀随能力并集给出工具清单，且不含「每轮」类无出处指令', () => {
    const suffix = buildKvSystemSuffix(makeService());
    expect(suffix).toContain(KV_TOOL_NAMES.read);
    expect(suffix).toContain(KV_TOOL_NAMES.write);
    expect(suffix).not.toContain('每轮先读');
    expect(suffix).not.toContain('默认第一步');
  });
});
