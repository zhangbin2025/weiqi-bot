/**
 * 宿主级工具：取回一个公开网页资源
 * @module application/chat/WebFetchTool
 *
 * 这是「网络能力」挂到标准 tool-calling agent loop 上的第一个工具。
 * 链路：模型给出 URL → 本工具校验 → 透明代理 api.weiqi.lol?url=… → 文本回填。
 *
 * 边界（和已验收的 weiqi-proxy 一致）：
 * - 只做「把字节送到」，不搜索、不解析 HTML、不判语义、不缓存、不落日志。
 * - 第一版只回文本：HTML / JSON / 纯文本原样进上下文由模型自己归纳；
 *   图片 / PDF 等二进制不往上下文塞（转 base64 / 抽文本归后续端侧插件）。
 * - 授权（Authorization / X-Cookie / X-Referer）由后续端侧插件决定，
 *   本工具不提供任何鉴权来源，也不注入默认 Referer / User-Agent。
 *
 * URL 校验是防护边界而非业务语义：只放行 http/https，拒绝环回 / 私网
 * 字面地址（RFC 1918 / 3927 / 5735 定义的地址段）。域名解析到私网 IP
 * 的场景由 Cloudflare 平台兜底，本层不做 DNS 解析。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';

/** 工具名：模型按这个名字发起调用，改动需同步 WEB_FETCH_TOOL.function.name */
export const WEB_FETCH_TOOL_NAME = 'web_fetch';

export const WEB_FETCH_TOOL: ModelToolDefinition = {
  name: WEB_FETCH_TOOL_NAME,
  description:
    '取回一个公开网页资源并返回其文本内容（HTML / JSON / 纯文本）。' +
    '当你需要读取某个具体网页、核实资料或归纳用户给出的链接时调用。' +
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
      const observation = `web_fetch：${url} 返回 ${response.status}，Content-Type=${contentType}。` +
        '该资源是二进制内容，第一版只支持文本，未读取内容。请改用文本型 URL 或直接说明无法读取。';
      return { observation, ok: false, detail: `二进制资源 ${response.status} ${contentType}` };
    }
    const observation = `web_fetch：${url}\nHTTP ${response.status} ${response.statusText}\nContent-Type: ${contentType}\n\n${text}`;
    return {
      observation,
      ok: response.ok,
      detail: `${url} → HTTP ${response.status}，${text.length} 字符`,
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
