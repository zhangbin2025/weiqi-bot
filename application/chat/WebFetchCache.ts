/**
 * web_fetch 取回正文的宿主缓存 + 内置读取工具
 * @module application/chat/WebFetchCache
 *
 * 为什么存在：ToolLoop.clipObservation() 按 CONTEXT_LIMITS.maxCharsPerMessage
 * 裁剪每条 role:'tool' 观察。web_fetch 若把完整正文塞进观察，超过上限的部分
 * 根本没进模型上下文 —— 端侧插件再精确也读不到不存在的字节。因此把完整正文
 * 留在宿主侧（不进观察），观察只回元信息 + 一小段预览 + 缓存句柄；模型需要
 * 其余部分时用 web_cache_read 分页 / 按正则取，每次返回都自觉控制在上限内。
 *
 * 缓存口径（逐条可追溯，不引入经验阈值）：
 * - 键 = 规范化后的 URL（validateWebFetchUrl 的输出）。同 URL 再次 fetch 覆盖，
 *   不重复增长；不同 URL 各占一份。
 * - 不设淘汰条数 / 过期时间：任何固定上限都是扫出来的经验值，换个用法就失效。
 *   条目数 = 本进程内模型实际取回过的不同公开 URL 数，是行为的自然结果而非阈值。
 * - 不落盘、不记时间戳、不读时钟：进程内 Map，页面刷新即失效；缓存内容全是
 *   模型主动取回的公开资源，不涉本地私有数据。
 * - 输出体积 / 分页长度一律由 CONTEXT_LIMITS.maxCharsPerMessage 推导，
 *   与历史构造、ToolLoop 裁剪同源，不另设数值。
 *
 * 读取语义对标命令行工具，但输入输出都是纯文本观察：
 *   info  -> 元信息（字符数 / 行数 / 状态 / 类型）
 *   slice -> 按字符区间读，对标 dd/sed -n；offset 可翻页
 *   grep  -> 逐行正则匹配 + 前后上下文行，对标 grep -n / -A / -B / -c
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import { CONTEXT_LIMITS } from './ConversationPrompt';

/** 工具名：模型按这个名字发起调用 */
export const WEB_CACHE_READ_TOOL_NAME = 'web_cache_read';

export const WEB_CACHE_READ_TOOL: ModelToolDefinition = {
  name: WEB_CACHE_READ_TOOL_NAME,
  description:
    '读取 web_fetch 已缓存的完整正文。web_fetch 的观察只含一小段预览，' +
    '未显示的部分必须用它读，绝不能凭预览猜测或编造。' +
    'url 填 web_fetch 观察里给出的那个绝对 URL（缓存按 URL 索引）。' +
    '三种 mode：info 看总字符数/行数；slice 按字符区间分页（不给 length 时自动按上下文上限推导）；' +
    'grep 用正则逐行查找，可带 before/after 上下文行、skip/limit 翻页、count 只回计数。' +
    '每次返回都控制在单条观察上限内，读不完就按提示继续翻页。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'web_fetch 观察里给出的绝对 URL，必须是 http/https 开头；缓存按此 URL 索引',
      },
      mode: {
        type: 'string',
        enum: ['info', 'slice', 'grep'],
        description: 'info=元信息 / slice=字符区间分页 / grep=逐行正则查找',
      },
      offset: {
        type: 'integer', minimum: 0,
        description: 'slice 的起始字符偏移（0 起，与 String.slice 同口径）；不传为 0',
      },
      length: {
        type: 'integer', minimum: 1,
        description: 'slice 要读多少字符；不传则由 CONTEXT_LIMITS.maxCharsPerMessage 减去头部/尾部开销推导',
      },
      pattern: {
        type: 'string',
        description: 'grep 的正则字符串；语法受当前 JS 引擎 RegExp 限制',
      },
      flags: {
        type: 'string',
        description: 'grep 的正则标志，只允许 i/m/s/u；不允许 g/y（lastIndex 状态会让结果不确定）',
      },
      before: {
        type: 'integer', minimum: 0,
        description: 'grep 命中行之前带几行上下文；不传为 0（不带上下文是语义，不是阈值）',
      },
      after: {
        type: 'integer', minimum: 0,
        description: 'grep 命中行之后带几行上下文；不传为 0',
      },
      skip: {
        type: 'integer', minimum: 0,
        description: 'grep 跳过前 N 条命中，用于翻页；不传为 0',
      },
      limit: {
        type: 'integer', minimum: 1,
        description: 'grep 最多回多少条命中；不传则按输出字符上限能装多少回多少',
      },
      count: {
        type: 'boolean',
        description: 'grep 为 true 时只回命中行数，不回行内容',
      },
    },
    required: ['url', 'mode'],
    additionalProperties: false,
  },
};

/** 一条缓存：完整正文 + 取回时的响应元信息，不含时钟 / 随机数 */
export interface CachedWebResource {
  url: string;
  status: number;
  statusText: string;
  contentType: string;
  /** 未裁剪的完整响应正文 */
  text: string;
  ok: boolean;
}

/** 可注入的缓存接口；默认用进程内 Map 单例 */
export interface WebFetchCache {
  put(url: string, entry: CachedWebResource): void;
  get(url: string): CachedWebResource | undefined;
  /** 当前缓存的 URL 列表（供 info 展示，不暴露正文） */
  keys(): string[];
}

export function createMemoryWebFetchCache(): WebFetchCache {
  const store = new Map<string, CachedWebResource>();
  return {
    put(url, entry) { store.set(url, entry); },
    get(url) { return store.get(url); },
    keys() { return [...store.keys()]; },
  };
}

/** 进程内默认单例：ChatPage 的 webTools 不注入 cache 时，两条工具路径共享这一份 */
export const defaultWebFetchCache: WebFetchCache = createMemoryWebFetchCache();

/**
 * 与 ToolOutcome 同形状的结果。
 * preparatory 恒为 true：本工具是「只读准备动作」（读缓存不产生任何状态变更），
 * 沿用 ToolLoop 既有机制与 PluginTools 里 list/show/history/debug 的同一条口径，
 * 让分页读取不消耗自主决策轮数 —— 否则 4 轮上限下长文档根本翻不完。
 * 总调用轮数 guard（maxTurns × maxTurns）仍是防无限循环的既有兜底。
 */
export interface WebCacheReadResult {
  observation: string;
  ok: boolean;
  detail: string;
  preparatory: true;
}

/** 单条观察的字符上限，与 ToolLoop.clipObservation / 历史构造同源 */
const BUDGET = CONTEXT_LIMITS.maxCharsPerMessage;

function fail(message: string): ReadResult {
  return { observation: `web_cache_read：${message}`, ok: false, detail: message };
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function isPosInt(v: unknown): v is number {
  return isNonNegInt(v) && v > 0;
}

/** 按 \n 切行并记下每行起始字符偏移；与 grep -n 的「行」口径一致 */
function splitLines(text: string): { lines: string[]; starts: number[] } {
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    starts.push(at);
    at += (lines[i] ?? '').length + 1; // +1 是被 split 吃掉的换行符
  }
  return { lines, starts };
}

function header(entry: CachedWebResource, lineCount: number): string {
  return `web_cache_read：${entry.url}\n`
    + `HTTP ${entry.status} ${entry.statusText}；Content-Type: ${entry.contentType}；`
    + `缓存正文 ${entry.text.length} 字符 / ${lineCount} 行\n`;
}

/**
 * slice：把完整正文按字符区间读出，整条观察严格不超过 BUDGET。
 *
 * 长度推导（无经验常数）：length = BUDGET - header.length - footer.length。
 * footer 里含 length / end，与长度互相依赖，用固定点迭代收敛（单调、最多几轮）。
 * 调用方显式给 length 时不推导，但仍会按 BUDGET 收口，保证不触发 loop 二次裁剪。
 */
function doSlice(entry: CachedWebResource, offset: number, givenLength: number | undefined): ReadResult {
  const total = entry.text.length;
  const lineCount = splitLines(entry.text).lines.length;
  const head = header(entry, lineCount);
  const start = Math.min(offset, total);
  const footTemplate = (len: number, end: number): string =>
    `\n[本段起点 ${start}，长度 ${len}，范围 [${start}, ${end}) / 共 ${total} 字符；`
    + (end < total ? `未到末尾，请把 offset 设为 ${end} 继续读]` : '已到正文末尾]');
  // 求最大可用 body 长度：foot 必须用**真实 body 长度**计算，否则 footer 里
  // length/end 的数字位数一变长，观察就会超预算被 clipObservation 二次裁剪，
  // 长文档后半段每片能吃到的正文会明显缩水（实测 100k 时 1830 → 1476）。
  // 迭代单调不增（每次按超出量削减），必然收敛。
  let derived = Math.max(0, BUDGET - head.length - footTemplate(0, start).length);
  for (let i = 0; i < 16; i++) {
    const end = Math.min(total, start + derived);
    const used = head.length + derived + footTemplate(derived, end).length;
    if (used <= BUDGET) break;
    derived = Math.max(0, derived - (used - BUDGET));
  }
  const length = Math.min(givenLength ?? derived, total - start);
  if (length <= 0) {
    return {
      observation: head + '[起点已到正文末尾，请减小 offset]',
      ok: true,
      detail: `slice 起点 ${start} 已在末尾`,
    };
  }
  // 显式 length 可能超出预算：按「真实 body 长度算 foot」收口，保证整条观察 ≤ BUDGET
  let body = entry.text.slice(start, start + length);
  let foot = footTemplate(body.length, start + body.length);
  if (head.length + body.length + foot.length > BUDGET) {
    let allowed = body.length;
    for (let i = 0; i < 16; i++) {
      const end = start + allowed;
      const used = head.length + allowed + footTemplate(allowed, end).length;
      if (used <= BUDGET) break;
      allowed = Math.max(0, allowed - (used - BUDGET));
    }
    body = body.slice(0, allowed);
    foot = footTemplate(body.length, start + body.length);
  }
  const observation = head + body + foot;
  return {
    observation: observation.length > BUDGET ? observation.slice(0, BUDGET) : observation,
    ok: true,
    detail: `slice [${start}, ${start + body.length}) / ${total} 字符`,
  };
}

/** grep：逐行正则匹配，可带上下文行；输出按 BUDGET 收口并提示剩余条数 */
function doGrep(
  entry: CachedWebResource,
  opts: {
    pattern: string; flags: string; before: number; after: number;
    skip: number; limit?: number; count: boolean;
  },
): ReadResult {
  const { lines, starts } = splitLines(entry.text);
  const head = header(entry, lines.length);
  let re: RegExp;
  try {
    // 每行新建 RegExp，flags 不含 g/y，lastIndex 不产生跨行状态
    re = new RegExp(opts.pattern, opts.flags);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`pattern 不是合法正则：${reason}`);
  }
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // 同一正则对象无 g 标志，test 不会推进 lastIndex；每次结果只依赖该行内容
    if (re.test(lines[i] ?? '')) hits.push(i);
  }
  if (opts.count) {
    return {
      observation: head + `grep /${opts.pattern}/${opts.flags} 命中 ${hits.length} 行（共 ${lines.length} 行）`,
      ok: true,
      detail: `grep 命中 ${hits.length} 行`,
    };
  }
  const page = hits.slice(opts.skip, opts.limit === undefined ? undefined : opts.skip + opts.limit);
  const foot = (shown: number): string => {
    const remaining = hits.length - opts.skip - shown;
    if (shown === 0 && page.length > 0) {
      return `\n[没有任何一条命中能装进单条观察：请改用 mode=slice 按字符读，或把 before/after 调小]`;
    }
    return `\n[已显示 ${shown} 条命中，共 ${hits.length} 条；`
      + (remaining > 0 ? `还有 ${remaining} 条，请把 skip 设为 ${opts.skip + shown} 继续读]` : '已到末尾]');
  };
  // foot 里数字位数随 shown 变化；取所有可能取值中的最大长度做保守预算，
  // 保证循环里任何一步都不会因尾部变长而越界（无经验常数，纯字符串长度计算）。
  let footBudget = 0;
  for (let n = 0; n <= hits.length; n++) footBudget = Math.max(footBudget, foot(n).length);
  const pieces: string[] = [];
  let used = head.length + footBudget;
  let shown = 0;
  for (const hit of page) {
    const from = Math.max(0, hit - opts.before);
    const to = Math.min(lines.length - 1, hit + opts.after);
    let block = '';
    for (let j = from; j <= to; j++) {
      const mark = j === hit ? '>' : ' ';
      const lineNo = String(j + 1);
      const at = starts[j] ?? 0;
      block += `${mark} ${lineNo} @${at} ${lines[j] ?? ''}\n`;
    }
    if (used + block.length > BUDGET - footBudget) break;
    pieces.push(block);
    used += block.length;
    shown++;
  }
  const observation = head + pieces.join('') + foot(shown);
  // 一条都装不进时明确判失败：有命中却没回任何内容，不能让模型误以为「读过了」。
  const noRoom = shown === 0 && page.length > 0;
  return {
    // 极端长 URL / 超长单行时头部本身可能吃掉大半预算，尾部再兜一次：
    // 宁可少回几行，也绝不让 ToolLoop 二次裁剪把「继续读」的提示切掉。
    observation: observation.length > BUDGET
      ? (head.length >= BUDGET ? head.slice(0, BUDGET) : head + pieces.join('').slice(0, Math.max(0, BUDGET - head.length - footBudget)) + foot(shown))
      : observation,
    ok: !noRoom,
    detail: noRoom
      ? 'grep 命中行放不进单条观察，请改用 slice 或调小上下文'
      : `grep 命中 ${hits.length} 行，显示 ${shown} 条`,
  };
}

/** 读取工具执行器：失败一律变成观察，不抛给 loop */
export function executeWebCacheRead(
  argsJson: string,
  cache: WebFetchCache = defaultWebFetchCache,
): WebCacheReadResult {
  return { ...readImpl(argsJson, cache), preparatory: true };
}

type ReadResult = Omit<WebCacheReadResult, 'preparatory'>;

function readImpl(
  argsJson: string,
  cache: WebFetchCache,
): ReadResult {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('参数必须是对象');
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return fail('参数不是合法 JSON 对象');
  }
  const url = args['url'];
  const mode = args['mode'];
  if (typeof url !== 'string' || !url.trim()) return fail('缺少 url（填 web_fetch 观察里的绝对 URL）');
  if (mode !== 'info' && mode !== 'slice' && mode !== 'grep') {
    return fail('mode 必须是 info / slice / grep 之一');
  }
  // 与 validateWebFetchUrl 同口径规范化：URL 构造器会把 https://example.com 补成
  // https://example.com/，而缓存键是规范化后的 URL。模型照抄观察里的 URL 本就一致，
  // 这里再兜一层，避免模型手写时漏掉尾部斜杠而查不到（纯函数，不联网、不引入依赖）。
  let key = url.trim();
  try {
    const parsed = new URL(key);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') key = parsed.toString();
  } catch { /* 保留原串，下面会给出「没有缓存」的明确提示 */ }
  const entry = cache.get(key);
  if (!entry) {
    const known = cache.keys();
    const hint = known.length > 0
      ? `当前已缓存 ${known.length} 份：${known.join('、')}`
      : '当前没有任何缓存';
    return fail(`该 URL 没有缓存，请先调用 web_fetch 取回它。${hint}`);
  }
  const { lines } = splitLines(entry.text);

  if (mode === 'info') {
    return {
      observation: header(entry, lines.length)
        + `缓存中共有 ${cache.keys().length} 份资源；`
        + `用 mode=slice 按字符分页，或 mode=grep 按正则查找。`,
      ok: true,
      detail: `info ${entry.text.length} 字符 / ${lines.length} 行`,
    };
  }

  if (mode === 'slice') {
    const offset = args['offset'] === undefined ? 0 : args['offset'];
    const length = args['length'] === undefined ? undefined : args['length'];
    if (!isNonNegInt(offset)) return fail('offset 必须是非负整数');
    if (length !== undefined && !isPosInt(length)) return fail('length 必须是正整数');
    return doSlice(entry, offset, length);
  }

  // grep
  const pattern = args['pattern'];
  if (typeof pattern !== 'string' || pattern === '') return fail('grep 需要非空 pattern（正则字符串）');
  const flags = args['flags'] === undefined ? '' : args['flags'];
  if (typeof flags !== 'string' || /[^imsu]/.test(flags)) {
    return fail('flags 只允许 i/m/s/u，且不允许 g/y');
  }
  const nums: Array<[string, unknown, boolean]> = [
    ['before', args['before'] === undefined ? 0 : args['before'], false],
    ['after', args['after'] === undefined ? 0 : args['after'], false],
    ['skip', args['skip'] === undefined ? 0 : args['skip'], false],
    ['limit', args['limit'], true],
  ];
  for (const [name, v, positive] of nums) {
    if (v !== undefined && (positive ? !isPosInt(v) : !isNonNegInt(v))) {
      return fail(`${name} 必须是${positive ? '正' : '非负'}整数`);
    }
  }
  const count = args['count'];
  if (count !== undefined && typeof count !== 'boolean') return fail('count 必须是布尔值');
  return doGrep(entry, {
    pattern,
    flags,
    before: (args['before'] as number | undefined) ?? 0,
    after: (args['after'] as number | undefined) ?? 0,
    skip: (args['skip'] as number | undefined) ?? 0,
    ...(args['limit'] !== undefined ? { limit: args['limit'] as number } : {}),
    count: count === true,
  });
}
