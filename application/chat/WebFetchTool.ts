/**
 * 宿主级工具：取回一个公开网页资源
 * @module application/chat/WebFetchTool
 *
 * 这是「网络能力」挂到标准 tool-calling agent loop 上的第一个工具。
 * 链路：模型给出 URL → 本工具校验 → 透明代理 api.weiqi.lol?url=… → 文本回填。
 *
 * 边界（和已验收的 weiqi-proxy 一致）：
 * - 只做「把字节送到」，不搜索、不解析 HTML、不判语义、不落日志。
 * - 完整正文存入宿主缓存（WebFetchCache），观察只回元信息 + 预览 + 句柄；
 *   其余部分由 web_cache_read 按字符分页 / 正则读取。这不为「省 token」，
 *   而是因为 ToolLoop.clipObservation() 会把超长观察裁掉，塞得再多也进不了上下文。
 * - web_fetch 只回文本：HTML / JSON / 纯文本由模型自己归纳；
 *   图片 / PDF 等二进制不往上下文塞。读 PDF / 图片请用独立工具
 *   web_read_pdf / web_read_image（见 WebResourceTools.ts），它们复用本文件的
 *   URL 校验与代理链路，把字节交给端侧抽取 / 多模态转换器。
 * - 授权（Authorization / X-Cookie / X-Referer）由后续端侧插件决定，
 *   本工具不提供任何鉴权来源，也不注入默认 Referer / User-Agent。
 *
 * URL 校验是防护边界而非业务语义：只放行 http/https，拒绝环回 / 私网
 * 字面地址（RFC 1918 / 3927 / 5735 定义的地址段）。域名解析到私网 IP
 * 的场景由 Cloudflare 平台兜底，本层不做 DNS 解析。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import { CONTEXT_LIMITS } from './ConversationPrompt';
import { defaultWebFetchCache, type CachedWebResource, type WebFetchCache } from './WebFetchCache';

/** 工具名：模型按这个名字发起调用，改动需同步 WEB_FETCH_TOOL.function.name */
export const WEB_FETCH_TOOL_NAME = 'web_fetch';

export const WEB_FETCH_TOOL: ModelToolDefinition = {
  name: WEB_FETCH_TOOL_NAME,
  description:
    '取回一个公开网页资源并把完整正文存入宿主缓存，返回的内容含 URL、状态、' +
    '正文总字符数与一小段预览。' +
    '⚠️ 预览只是一部分，未显示的正文绝不能凭猜测补写：' +
    '用 web_cache_read（url 填本观察里的 URL）按 mode=slice 分页或 mode=grep 正则查找。' +
    '同一个 URL 再次调用会重新取回并覆盖缓存。' +
    '只用于 GET；只传 http/https 绝对 URL。返回的是原始文本，不是搜索结果。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要取回的公开网页绝对 URL，必须是 http:// 或 https:// 开头',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

export interface WebFetchResult {
  /** 回填给模型的观察文本（含状态与正文） */
  observation: string;
  /** 是否成功（用于过程块标记 ok） */
  ok: boolean;
  /** 一行人话摘要（过程块显示） */
  detail: string;
}

/** 取回工具的可注入依赖，便于测试 */
export interface WebFetchToolDeps {
  proxyUrl: string;
  /** 超时（毫秒）。沿用已配置的 LLM timeoutMs，不另设数值 */
  timeoutMs: number;
  /** 可替换的 fetch，默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** 缓存注入；不传用进程内单例（与 web_cache_read 共享） */
  cache?: WebFetchCache;
}

const NO_FETCH_BODY_METHOD = 'GET';

/** 与 Worker 同口径的私网 / 环回字面地址判定 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('::ffff:127.')) return true;
  // IPv6：fc00::/7（唯一本地）、fe80::/10（链路本地）
  if (/^f[cd][0-9a-f]*:/.test(h) || /^fe[89ab][0-9a-f]*:/.test(h)) return true;
  // IPv4 字面地址
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 127 || a >= 224) return true;         // 0/8, 127/8, >=224/4
  if (a === 10) return true;                                  // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16/12
  if (a === 192 && b === 168) return true;                    // 192.168/16
  if (a === 169 && b === 254) return true;                    // 169.254/16
  return false;
}

/** 校验并规范化目标 URL；抛出的错误文案直接作为工具观察回给模型 */
export function validateWebFetchUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('url 不是合法的绝对 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只允许 http/https 协议');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('不允许访问环回或私网地址');
  }
  return parsed.toString();
}

/**
 * 执行 web_fetch。任何失败都不抛给 loop，而是变成一条「观察」回填，
 * 让模型自己决定重试、换 URL 还是直接说明无法访问。
 */
export async function executeWebFetch(argsJson: string, deps: WebFetchToolDeps): Promise<WebFetchResult> {
  let url: string;
  try {
    const args = JSON.parse(argsJson) as { url?: unknown };
    if (typeof args.url !== 'string' || !args.url.trim()) {
      throw new Error('缺少 url 参数');
    }
    url = validateWebFetchUrl(args.url.trim());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const observation = `web_fetch 参数无效：${reason}。请给出 http/https 开头的公开网页绝对 URL。`;
    return { observation, ok: false, detail: `参数无效：${reason}` };
  }

  const target = `${deps.proxyUrl}/?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(target, {
      method: NO_FETCH_BODY_METHOD,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    // 第一版只回文本：二进制资源即使字节到了也不往上下文塞，
    // 明确告知模型「这是二进制，无法读取内容」，避免把乱码喂进去。
    if (/^(image|audio|video)\//i.test(contentType)
      || /^application\/(pdf|octet-stream|zip|x-zip-compressed|gzip|x-tar|x-bzip2|wasm)/i.test(contentType)) {
      // 文案只做能力指路，不改行为：二进制内容依然不进上下文。
      // 让误用 web_fetch 的模型知道有专门工具，而不是笼统地说「换文本 URL」。
      const ct = contentType.split(';')[0]!.trim().toLowerCase();
      const hint = ct === 'application/pdf'
        ? '请改用 web_read_pdf 读取这份 PDF（mode=text 抽文字 / mode=native 送原文）。'
        : ct.startsWith('image/')
          ? '请改用 web_read_image 读取这张图片。'
          : '请改用对应工具或如实说明无法读取。';
      const observation = `web_fetch：${url} 返回 ${response.status}，Content-Type=${contentType}。` +
        `该资源是二进制内容，web_fetch 只支持文本，未读取内容。${hint}`;
      return { observation, ok: false, detail: `二进制资源 ${response.status} ${contentType}` };
    }
    // 完整正文留宿主侧：观察文本会被 ToolLoop.clipObservation() 裁到
    // CONTEXT_LIMITS.maxCharsPerMessage，塞全量只会让后半截「从未进过上下文」。
    // 预览长度由同一常量推导（预留元信息头与尾部提示的空间），不另造阈值。
    const entry: CachedWebResource = {
      url, status: response.status, statusText: response.statusText,
      contentType, text, ok: response.ok,
    };
    (deps.cache ?? defaultWebFetchCache).put(url, entry);
    const lineCount = text.split('\n').length;
    const head = `web_fetch：${url}\n`
      + `HTTP ${response.status} ${response.statusText}\n`
      + `Content-Type: ${contentType}\n`
      + `完整正文 ${text.length} 字符 / ${lineCount} 行，已存入宿主缓存。\n`
      + `其余内容请用 web_cache_read 读取（url 填上面的 URL，mode=slice 分页 / mode=grep 查找）；`
      + `不要凭预览猜测未显示的部分。\n\n`;
    const foot = (n: number): string =>
      `\n\n[预览 ${n} / ${text.length} 字符`
      + (n < text.length ? '；未到末尾，用 web_cache_read 继续读]' : '；正文已全部显示]');
    // footer 里含 n 本身，长度与 n 互相依赖。固定点迭代：先用 0 占位算长度，
    // 再用真实 footer 重算，直到稳定（n 只会变短，单调收敛，最多几轮）。
    // 全程只有 CONTEXT_LIMITS.maxCharsPerMessage 一个数值来源，不另造阈值。
    let previewLength = Math.max(0, CONTEXT_LIMITS.maxCharsPerMessage - head.length - foot(0).length);
    for (let i = 0; i < 8; i++) {
      const next = Math.max(0, CONTEXT_LIMITS.maxCharsPerMessage - head.length - foot(previewLength).length);
      if (next === previewLength) break;
      previewLength = next;
    }
    const body = text.slice(0, previewLength);
    const observation = head + body + foot(body.length);
    return {
      observation,
      ok: response.ok,
      detail: `${url} → HTTP ${response.status}，${text.length} 字符（已缓存）`,
    };
  } catch (error) {
    const reason = error instanceof Error
      ? (error.name === 'AbortError' ? `超时（${deps.timeoutMs / 1000}s）` : error.message)
      : String(error);
    const observation = `web_fetch 访问 ${url} 失败：${reason}`;
    return { observation, ok: false, detail: `访问失败：${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
