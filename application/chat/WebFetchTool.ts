/**
 * 宿主级工具：取回一个公开网页资源
 * @module application/chat/WebFetchTool
 *
 * 这是「网络能力」挂到标准 tool-calling agent loop 上的第一个工具。
 * 链路：模型给出 URL → 本工具校验 → 透明代理 api.weiqi.lol?url=… → 文本回填。
 *
 * 边界（和已验收的 weiqi-proxy 一致）：
 * - 只做「把字节送到」，不搜索、不解析 HTML、不判语义、不落日志。
 * - 完整正文始终存入宿主缓存（WebFetchCache）。观察分三种：
 *   · storeOnly=true → 只回 URL / 状态 / 字符数句柄，不回任何正文或预览；
 *     只写宿主缓存，正文不进模型上下文；阶段二 workflow 用 宿主 JSON 算子 从上游
 *     value 提取、display 纯渲染（本工具不读缓存，缓存句柄形状不变）；
 *   · 短响应（整份 head + 正文 + foot ≤ 单条上限）→ **直接给完整正文**，
 *     不再需要 web_cache_read 翻页，少了整串「预览→分页→重发历史」的模型往返；
 *   · 长响应 → 只回元信息 + 预览 + 句柄，其余由 web_cache_read 分页 / 正则读取。
 *   后两种的判据只有 CONTEXT_LIMITS.maxCharsPerMessage 一个既有常量，不另造阈值。
 * - web_fetch 只回文本：HTML / JSON / 纯文本由模型自己归纳；
 *   图片 / PDF 等二进制不往上下文塞。读 PDF / 图片请用独立工具
 *   web_read_pdf / web_read_image（见 WebResourceTools.ts），它们复用本文件的
 *   URL 校验与代理链路，把字节交给端侧抽取 / 多模态转换器。
 * - 授权（Authorization / X-Cookie / X-Referer）由后续端侧插件决定，
 *   本工具不提供任何鉴权来源，也不注入伪造的 Referer / User-Agent。
 *   唯一多带一个 X-User-Agent：透明代理只认请求端显式给出的头、不会回落到
 *   浏览器自动携带的 UA，缺 UA 时部分站点（如微信公众号文章）只返回验证页
 *   而非正文；代理把该头还原成标准 User-Agent。三端代理均已支持 X-User-Agent。
 *   取值统一由本模块导出的 resolveProxyUserAgent() 决定（纯 Web 用浏览器真实
 *   UA；原生壳的 WeiqiApp/1.0 分流标识回落到既有标准浏览器 UA），web_fetch
 *   与 ResourceInput.fetchResourceFromUrl（图片/PDF 字节）共用同一真相源。
 *
 * URL 校验是防护边界而非业务语义：只放行 http/https，拒绝环回 / 私网
 * 字面地址（RFC 1918 / 3927 / 5735 定义的地址段）。域名解析到私网 IP
 * 的场景由 Cloudflare 平台兜底，本层不做 DNS 解析。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import { CONTEXT_LIMITS } from './ConversationPrompt';
import { defaultWebFetchCache, type CachedWebResource, type WebFetchCache } from './WebFetchCache';

/**
 * 抓取用的标准浏览器 UA。
 *
 * 出处：PlaywrightSnifferProvider 启动浏览器会话时已使用的默认值
 * （infrastructure/network/adapters/cli/PlaywrightSnifferProvider.ts:283），
 * 是仓库内既有的浏览器身份口径，不是外部抄袭、也不是在验证集上扫出来的经验值。
 *
 * 用途：原生壳（Electron setUserAgent / Android setUserAgentOverride）把
 * navigator.userAgent 覆盖成 "WeiqiApp/1.0"，用于三端分流（见
 * createAIEngine.isAppEnvironment），它不是浏览器身份。实测 2026-11-26 同一
 * URL / 同一代理下：该标识只得到 19KB 验证页，标准浏览器 UA 得到 3.8MB 全文；
 * 本机直连（绕过 Cloudflare）结果相同，说明与出口 IP 无关。因此仅当识别到壳
 * 标识时回落到这个值；纯 Web 仍用浏览器自身真实 UA，不回落、不伪造。
 */
export const FETCH_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * 解析「经透明代理发出的请求」应带上的 User-Agent。
 *
 * 透明代理只认请求端显式给出的头，不回落浏览器自动携带的 UA；三端代理都把
 * X-User-Agent 还原成标准 User-Agent。凡走 `${proxyUrl}/?url=` 的链路
 * （web_fetch 取正文、fetchResourceFromUrl 取图片/PDF 字节）统一走这里，
 * 保证 UA 口径单一真相源、原生壳回落逻辑不出现第二份常量/判据。
 *
 * - 纯 Web：返回浏览器自身真实 UA，不伪造。
 * - 原生壳：navigator.userAgent 被 override 成 WeiqiApp/1.0（分流标识，见
 *   createAIEngine.isAppEnvironment），部分站点（如微信公众号文章）据此只回
 *   验证页；回落到 FETCH_BROWSER_UA。
 * - navigator 不可用：返回 undefined，调用方不带该头，不臆造。
 */
export function resolveProxyUserAgent(): string | undefined {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return undefined;
  return navigator.userAgent.includes('WeiqiApp') ? FETCH_BROWSER_UA : navigator.userAgent;
}

/** 工具名：模型按这个名字发起调用，改动需同步 WEB_FETCH_TOOL.function.name */
export const WEB_FETCH_TOOL_NAME = 'web_fetch';

export const WEB_FETCH_TOOL: ModelToolDefinition = {
  name: WEB_FETCH_TOOL_NAME,
  description:
    '取回一个公开网页资源并把完整正文存入宿主缓存，返回的内容含 URL、状态、正文总字符数。' +
    '短响应会直接给出完整正文；长响应只给一小段预览。' +
    '⚠️ 预览只是一部分，未显示的正文绝不能凭猜测补写：' +
    '用 web_cache_read（url 填本观察里的 URL）按 mode=slice 分页或 mode=grep 正则查找，' +
    '分页时从预览末尾的 offset 继续，不要从 0 重读已给过的内容。' +
    '同一个 URL 再次调用会重新取回并覆盖缓存。' +
    '可选 storeOnly=true：完整正文只写宿主缓存，观察只回 URL / 状态 / 字符数句柄，'
    + '不回任何正文或预览；阶段二 workflow 用 JSON 沙箱算子 从上游 value 提取、'
    + 'display 纯渲染（本阶段 storeOnly 只写缓存，不读缓存），'
    + '大体积 JSON 不进模型上下文；此时不要用 web_cache_read 读回来，也不要凭句柄猜测正文。' +
    '只用于 GET；只传 http/https 绝对 URL。返回的是原始文本，不是搜索结果。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要取回的公开网页绝对 URL，必须是 http:// 或 https:// 开头',
      },
      storeOnly: {
        type: 'boolean',
        description:
          '可选，默认 false。true = 只把完整正文存入宿主缓存，观察只回句柄、不含任何正文或预览；'
          + '用于「取数 → 只写宿主缓存」的数据旁路，阶段二 workflow 用 JSON 沙箱算子 从上游 '
          + 'value 提取、display 纯渲染，让大体积 JSON 不进入模型上下文。',
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
  /**
   * 可选：算子的纯 value 出参（阶段二 workflow 连线只认它）。
   * 仅 storeOnly 分支产出：合法 JSON 给解析值、非 JSON 给原文字符串；
   * 散文配方仍只看 observation，零回归。
   */
  value?: unknown;
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
export async function executeWebFetch(args: Record<string, unknown>, deps: WebFetchToolDeps): Promise<WebFetchResult> {
  let url: string;
  let storeOnly = false;
  try {
    if (typeof args['url'] !== 'string' || !args['url'].trim()) {
      throw new Error('缺少 url 参数');
    }
    url = validateWebFetchUrl(args['url'].trim());
    // storeOnly 只认严格布尔 true；其它值一律按缺省（完整观察）处理，不静默吞正文。
    storeOnly = args['storeOnly'] === true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const observation = `web_fetch 参数无效：${reason}。请给出 http/https 开头的公开网页绝对 URL。`;
    return { observation, ok: false, detail: `参数无效：${reason}` };
  }

  const target = `${deps.proxyUrl}/?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  // 透明代理只认请求端显式给出的头，不会回落到浏览器自动携带的 UA，缺 UA 时
  // 微信等站点只返回验证页。UA 口径统一由 resolveProxyUserAgent() 决定，
  // 与 fetchResourceFromUrl（图片/PDF 字节）共用同一真相源。
  const headers: Record<string, string> = {};
  const proxyUserAgent = resolveProxyUserAgent();
  if (proxyUserAgent) headers['X-User-Agent'] = proxyUserAgent;
  try {
    const response = await fetchImpl(target, {
      method: NO_FETCH_BODY_METHOD,
      headers,
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
    // 完整正文始终留宿主缓存（同 URL 覆盖、web_cache_read 句柄等契约不变）。
    // 观察按体积分两种，判据只用一个既有常量 maxCharsPerMessage：
    //   · 短响应：head + 全文 + foot 装得下 → 直接给全文，省掉整串分页往返；
    //   · 长响应：只给预览 + 指路 web_cache_read（超长观察会被 clipObservation 裁掉，
    //     塞全量只会让后半截从未进过上下文）。
    const entry: CachedWebResource = {
      url, status: response.status, statusText: response.statusText,
      contentType, text, ok: response.ok,
    };
    (deps.cache ?? defaultWebFetchCache).put(url, entry);
    const lineCount = text.split('\n').length;

    // ---- storeOnly：正文只留在宿主缓存，观察只回句柄（数据旁路） ----
    // web_fetch(storeOnly) 只写宿主缓存；阶段二 workflow 用 JSON 沙箱算子 从上游 value
    // 提取、display 纯渲染（display 不再读 WebFetchCache）。
    // 模型既不收到正文也不收到预览，因此大体积 JSON 不产生延迟 / token 开销。
    // 这里只回元信息，不含一个字符的正文；也不指路 web_cache_read（默认流程不该读回来）。
    if (storeOnly) {
      // 阶段二命门修复：正文 text 已在手，把它作为算子的纯 value 出参交给 DAG runner
      // （JSON 沙箱算子 要的是已解析 JSON、display 要的是已解析数组）。
      // 合法 JSON 给解析值、非 JSON 给原文字符串；不新增阈值、不重试。仅本分支加。
      let value: unknown;
      try { value = JSON.parse(text) as unknown; } catch { value = text; }
      return {
        observation: `web_fetch：${url}\n`
          + `HTTP ${response.status} ${response.statusText}\n`
          + `完整正文 ${text.length} 字符 / ${lineCount} 行，已存入宿主缓存（storeOnly：正文不进上下文）。\n`
          + `这份资源交给宿主展示工具按上面的 URL 直接呈现给用户，不要调用 web_cache_read 读取正文，`
          + `也不要凭这段句柄猜测或补写内容。`,
        ok: response.ok,
        detail: `${url} → HTTP ${response.status}，${text.length} 字符（storeOnly，仅缓存）`,
        value,
      };
    }

    // ---- 短响应：整份观察能否装进单条上限？能就直接给全文 ----
    const fullHead = `web_fetch：${url}\n`
      + `HTTP ${response.status} ${response.statusText}\n`
      + `Content-Type: ${contentType}\n`
      + `完整正文 ${text.length} 字符 / ${lineCount} 行，已存入宿主缓存。\n`
      + `正文已全部显示，无需再调用 web_cache_read。\n\n`;
    const fullFoot = `\n\n[正文已全部显示，共 ${text.length} 字符]`;
    if (fullHead.length + text.length + fullFoot.length <= CONTEXT_LIMITS.maxCharsPerMessage) {
      return {
        observation: fullHead + text + fullFoot,
        ok: response.ok,
        detail: `${url} → HTTP ${response.status}，${text.length} 字符（已缓存，全文直给）`,
      };
    }

    // ---- 长响应：元信息 + 预览 + 句柄，其余由 web_cache_read 读 ----
    // 预览长度由同一常量推导（预留元信息头与尾部提示的空间），不另造阈值。
    const head = `web_fetch：${url}\n`
      + `HTTP ${response.status} ${response.statusText}\n`
      + `Content-Type: ${contentType}\n`
      + `完整正文 ${text.length} 字符 / ${lineCount} 行，已存入宿主缓存。\n`
      + `其余内容请用 web_cache_read 读取（url 填上面的 URL，mode=slice 分页 / mode=grep 查找）；`
      + `不要凭预览猜测未显示的部分。\n\n`;
    // footer 直接给出续读 offset：预览已给了前 n 字符，模型若仍用默认 offset=0
    // 调 slice，会把这 n 字符重读一遍，白白多一次模型往返且重复计费。
    // n 由上面的预览长度推导（既有事实），不引入新常量。
    const foot = (n: number): string =>
      `\n\n[预览 ${n} / ${text.length} 字符`
      + (n < text.length
        ? `；未到末尾，用 web_cache_read 继续读（mode=slice，offset 填 ${n}，不要从 0 重读）]`
        : '；正文已全部显示]');
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
