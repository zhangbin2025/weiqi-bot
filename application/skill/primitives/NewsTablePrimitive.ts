/**
 * 宿主展示原语：把 web_fetch(storeOnly) 留在缓存里的同花顺新闻 JSON 直接渲染成表格
 * @module application/skill/primitives/NewsTablePrimitive
 *
 * 数据旁路（本原语存在的唯一理由）：
 *   web_fetch(storeOnly=true) ── 完整正文只写 WebFetchCache，观察只回句柄 ──┐
 *                                                                          ├─ 模型只决定「调用 news_table」
 *   news_table(url) ── 宿主读缓存 → 生成 markdown 表格 → displayMarkdown ─────┘  正文全程不进模型上下文
 *
 * 链路：PrimitiveResult.displayMarkdown → ToolOutcome → ToolLoopResult →
 * ChatUseCase.renderMessage 第 11 参 → AssistantRenderer 单独渲染 → ChatMessage
 * 独立字段（renderSession 回放）。ToolLoop 只把 observation 追加成 role:'tool'，
 * displayMarkdown 从构造到落地没有任何一步经过模型消息或 ChatMessage.content。
 *
 * 在线配方是纯 JSON，parseSkillRecipe 只保留已知字段，无法构造 displayMarkdown；
 * 模型能传的只有 url，表格内容全部来自宿主缓存里的公开接口响应。
 *
 * 安全边界（宿主强制）：
 * - 每个外部字段先清控制字符、escapeHtml（& < > " '），再把 markdown 语法字符
 *   （\ | [ ] ( ) * _ ` 等）转成 HTML 实体、换行压成空格，然后才拼进单元格。
 *   交给 marked/innerHTML 之前不可信部分已全部转义，绝不把外部字符串当原始 markdown 执行。
 * - 原文链接只接受 http/https 绝对 URL，且不含空白 / 括号 / 引号 / 控制字符 / userinfo；
 *   不合规就退化成纯文本标题，绝不拼一个可能被注入的 [x](url)。
 * - 不显示接口未说明含义的字段，不换算 ctime / rtime（换算错就是编造）。
 *
 * 数值口径：表格行数 = 接口实际返回的 data.list.length；一次展示多少条由配方写在
 * URL 里的 pagesize 决定（业务明说的默认量），宿主不另设截断阈值 / 行数上限。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import { defaultWebFetchCache, type WebFetchCache } from '@application/chat/WebFetchCache';

export const NEWS_TABLE_TOOL_NAME = 'news_table';

export const NEWS_TABLE_TOOL: ModelToolDefinition = {
  name: NEWS_TABLE_TOOL_NAME,
  description:
    '读取 web_fetch(storeOnly=true) 留在宿主缓存里的同花顺财经新闻 JSON，' +
    '由宿主直接把新闻表格展示给用户（数据不进入模型上下文）。' +
    'url 填 web_fetch 观察里给出的那个绝对 URL。' +
    '工具返回后只写一句简短引导语并停笔：不要复述、归纳或读取表格里的新闻，' +
    '也不要调用 web_cache_read 把正文读回上下文。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'web_fetch(storeOnly=true) 观察里给出的绝对 URL，宿主按它从缓存读全文',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * markdown 表格单元格：清控制字符 → HTML 转义 → markdown 语法字符转实体 → 换行压空格。
 * 实体（如 &#124;）在 markdown 解析阶段只是普通文本，浏览器渲染时才还原成字符，
 * 因此既不会破表格分隔、也不会触发注入，用户看到的仍是原文。
 */
function cell(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return escapeHtml(cleaned)
    .replace(/\\/g, '&#92;')
    .replace(/\|/g, '&#124;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\(/g, '&#40;')
    .replace(/\)/g, '&#41;')
    .replace(/\*/g, '&#42;')
    .replace(/_/g, '&#95;')
    .replace(/`/g, '&#96;')
    .replace(/\r?\n/g, ' ')
    .trim() || '—';
}

/** 只放行不会逃出 markdown 链接语法的 http(s) 绝对 URL；否则返回 null */
function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  // 空白 / 尖括号 / 引号 / 反引号 / 反斜杠 / 括号 / 花括号 / 控制字符都可能破坏
  // [text](url) 语法或注入 href 属性，一律拒绝。
  // & 与 # 另加排除：它们本身合法，但 & 在 href 属性里需 HTML 转义（marked 的
  // 转义口径不该成为安全前提），# 会引入 fragment。同花顺新闻原文 URL 实测形如
  // https://news.10jqka.com.cn/20261120/c682029363.shtml —— 无 query / fragment，
  // 因此按接口事实收窄：命中这些字符就退化成纯文本标题，绝不拼可疑链接。
  // eslint-disable-next-line no-control-regex
  if (/[\s<>"'`\\()\[\]{}&#\u0000-\u001F]/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** stock[] 只取接口已文档化的 name；空或缺失显示占位符 */
function stockNames(raw: unknown): string {
  if (!Array.isArray(raw)) return '—';
  const names: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const name = cell((item as Record<string, unknown>)['name']);
    if (name !== '' && name !== '—') names.push(name);
  }
  return names.length > 0 ? names.join('、') : '—';
}

type TableResult =
  | { ok: true; markdown: string; count: number }
  | { ok: false; error: string };

/** 只读已文档化字段；code 不是 200 / 结构不符一律失败，不编造 */
function buildTable(parsed: Record<string, unknown>): TableResult {
  if (String(parsed['code']) !== '200') {
    return { ok: false, error: `接口返回 code=${String(parsed['code'])}（不是 200）` };
  }
  const d = parsed['data'];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { ok: false, error: '接口缺少 data 对象' };
  }
  const list = (d as Record<string, unknown>)['list'];
  if (!Array.isArray(list)) return { ok: false, error: '接口 data.list 不是数组' };

  const lines: string[] = [
    '| # | 分类 | 标题 | 摘要 | 相关个股 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const rec = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const title = cell(rec['title']);
    const href = safeHttpUrl(rec['url']);
    const titleCell = href ? `[${title}](${href})` : title;
    lines.push(`| ${i + 1} | ${cell(rec['tag'])} | ${titleCell} | ${cell(rec['digest'])} | ${stockNames(rec['stock'])} |`);
  }
  lines.push('');
  lines.push(`本次展示接口返回的 **${list.length}** 条（按接口返回顺序由新到旧）；数据来自同花顺财经新闻推送接口。`);
  lines.push('接口时间戳未换算为日期时间；新闻可能有滞后，仅供参考，不构成投资建议。');
  return { ok: true, markdown: lines.join('\n'), count: list.length };
}

function fail(reason: string): PrimitiveResult {
  return {
    observation: `news_table：${reason}。本次没能列出新闻，请如实告诉用户，不要编造，也不要改 URL 反复重试。`,
    ok: false,
    detail: reason,
  };
}

/**
 * 构造宿主展示原语。cache 与 web_fetch / web_cache_read 共用同一份 WebFetchCache：
 * 装配方传 webDeps.cache，未注入时落进程内默认单例（与 executeWebFetch 同口径）。
 */
export function createNewsTablePrimitive(
  cache: WebFetchCache = defaultWebFetchCache,
): SkillPrimitive {
  return {
    name: NEWS_TABLE_TOOL_NAME,
    definition: NEWS_TABLE_TOOL,
    execute: async (argsJson: string): Promise<PrimitiveResult> => {
      let url = '';
      try {
        const args = JSON.parse(argsJson) as { url?: unknown };
        if (typeof args.url !== 'string' || !args.url.trim()) throw new Error('缺少 url');
        url = args.url.trim();
      } catch {
        return fail('参数不是合法 JSON 或缺少 url（填 web_fetch 观察里的绝对 URL）');
      }
      // 与 executeWebCacheRead 同口径规范化缓存键：URL 构造器会补尾部斜杠，
      // 缓存键是 validateWebFetchUrl 的规范化输出，模型照抄观察里的 URL 本就一致。
      let key = url;
      try {
        const u = new URL(key);
        if (u.protocol === 'http:' || u.protocol === 'https:') key = u.toString();
      } catch { /* 保留原串，下面按「没有缓存」报明确错误 */ }

      const entry = cache.get(key);
      if (!entry) {
        const known = cache.keys();
        const hint = known.length > 0
          ? `当前已缓存 ${known.length} 份：${known.join('、')}`
          : '当前没有任何缓存';
        return fail(`该 URL 没有缓存，请先用 web_fetch(storeOnly=true) 取回它。${hint}`);
      }
      if (!entry.ok) {
        return fail(`取回失败（HTTP ${entry.status} ${entry.statusText}），没有可展示的新闻`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.text);
      } catch {
        return fail('缓存正文不是合法 JSON（可能被拦截返回 HTML），没有可展示的新闻');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('缓存正文不是 JSON 对象，没有可展示的新闻');
      }
      const built = buildTable(parsed as Record<string, unknown>);
      if (!built.ok) return fail(built.error);
      return {
        observation: `news_table：宿主已从缓存生成 ${built.count} 行新闻表格并直接展示给用户。`
          + '你不需要也不应该读取、复述或归纳表格内容；只写一句简短引导语并停笔，'
          + '不要调用 web_cache_read 把正文读回上下文。',
        ok: true,
        detail: `展示 ${built.count} 条新闻（宿主渲染，正文未进上下文）`,
        displayMarkdown: built.markdown,
      };
    },
  };
}
