/**
 * 资源输入统一抽象：把「URL」与「本地文件」收敛成同一种字节输入
 * @module application/chat/ResourceInput
 *
 * 两种来源、两条触发路径，最终汇合到本模块：
 * - URL：模型 tool_calls 决定读取 → fetchResourceFromUrl() 走透明代理
 * - 本地文件：用户选文件（宿主已明确给出）→ resourceFromFile()
 *
 * 之后统一由转换器变成模型输入 / 历史附件。代理三端（线上 Workers、
 * Android ProxyHandler、Desktop asset-server）都是字节透传，本模块不假设
 * 任何 content-type 白名单，靠响应头 + 魔数判定资源种类。
 *
 * 数值口径（用户 2026-11-13 决策：选 A，不新设任何字节上限）：
 * 字符预算只管文本，base64 二进制作为独立附件字段、不计入 CONTEXT_LIMITS，
 * 也不设人为字节阈值。超出端点/浏览器能力时由失败路径变观察，不做静默截断。
 * 「一般比较小」是业务前提，如实记录在此，不包装成算法常数。
 */

import type { WebFetchToolDeps } from './WebFetchTool';
import { validateWebFetchUrl } from './WebFetchTool';

/** 工具能处理的资源种类。unsupported 明确回观察，不猜内容。 */
export type ResourceKind = 'pdf' | 'image' | 'unsupported';

/** 统一后的资源输入 */
export interface ResourceInput {
  bytes: Uint8Array;
  /** 精确 MIME（data URI 用）；kind=unsupported 时为占位值，不可用于种类判定 */
  mimeType: string;
  /**
   * 一次判定、全程复用：下游不再用规范化后的 mimeType 二次 sniff。
   * 否则 unsupported 文件会被兜底 MIME 误判成图片（2026-11-13 实测踩到）。
   */
  kind: ResourceKind;
  /** 展示用名称（文件名 / URL 末段），不进模型上下文正文 */
  label: string;
  /** 来源 URL；本地文件没有 */
  sourceUrl?: string;
}

/** 送 vision 端点接受的 raster 图片 MIME；SVG 含脚本且端点普遍不支持，显式排除 */
const RASTER_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
]);

/**
 * 魔数优先、content-type 兜底判定资源种类。
 * 白名单是「常见 vision 端点支持的 raster 格式」这一明说的业务约束，
 * 不是从验证集扫出来的经验值。
 */
export function sniffResourceKind(bytes: Uint8Array, contentType: string): ResourceKind {
  const ct = contentType.split(';')[0]!.trim().toLowerCase();
  const head = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      if (bytes[i] !== s.charCodeAt(i)) return false;
    }
    return true;
  };
  const isPdf = head('%PDF-') || ct === 'application/pdf';
  if (isPdf) return 'pdf';
  if (RASTER_MIME.has(ct)) return 'image';
  if (bytes[0] === 0x89 && head('\x89PNG')) return 'image';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if (head('GIF87a') || head('GIF89a')) return 'image';
  if (head('RIFF') && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image';
  if (head('BM')) return 'image';
  // 有 image/* 头但不在白名单（如 SVG / AVIF）：明确当不支持，避免把
  // 端点读不了、甚至含脚本的内容塞进上下文再假装读过。
  return 'unsupported';
}

/** 从魔数/响应头推精确 MIME（data URI 需要正确 mimeType，不能一律 octet-stream） */
export function resolveMimeType(bytes: Uint8Array, contentType: string, kind: ResourceKind): string {
  const ct = contentType.split(';')[0]!.trim().toLowerCase();
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'image' && RASTER_MIME.has(ct)) return ct;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return 'image/png';
}

/**
 * 逐字节拼 binary 串再编码，避免引入「单次展开参数上限」这类分块常数。
 * V8 对字符串拼接有 rope 优化；在「附件一般比较小」的业务前提下足够。
 * 原生 PDF 可能到 MB 级，仍按同一条路径处理：不设人为字节上限，
 * 超出端点/浏览器能力时由失败路径变观察，不做静默截断（决策 5A）。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  if (typeof btoa === 'function') return btoa(binary);
  // Node/测试环境兜底
  return Buffer.from(binary, 'binary').toString('base64');
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

/** URL 末段做展示名；取不到就用主机名，不引截断常数 */
function labelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    if (!last) return parsed.hostname;
    try { return decodeURIComponent(last); } catch { return last; }
  } catch {
    return '网络资源';
  }
}

/**
 * 从公开 URL 取回原始字节。失败一律变「观察」用的错误文本，不抛给 loop。
 * 显式带 X-User-Agent（浏览器自身 UA，来源清楚），因为部分图片站点对无 UA
 * 请求返 403；代理白名单会把 X- 前缀还原成标准 User-Agent，三端一致。
 */
export async function fetchResourceFromUrl(
  rawUrl: string,
  deps: WebFetchToolDeps,
): Promise<{ ok: true; resource: ResourceInput } | { ok: false; error: string }> {
  let url: string;
  try {
    url = validateWebFetchUrl(rawUrl.trim());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `URL 无效：${reason}` };
  }

  const target = `${deps.proxyUrl}/?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    headers['X-User-Agent'] = navigator.userAgent;
  }
  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return { ok: false, error: `取回 ${url} 失败：HTTP ${response.status} ${response.statusText}` };
    }
    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const contentType = response.headers.get('content-type') ?? '';
    const kind = sniffResourceKind(bytes, contentType);
    if (kind === 'unsupported') {
      return { ok: false, error: `${url} 返回的是不受支持的资源类型（${contentType || '未知'}），无法读取。` };
    }
    const resource: ResourceInput = {
      bytes,
      mimeType: resolveMimeType(bytes, contentType, kind),
      kind,
      label: labelFromUrl(url),
      sourceUrl: url,
    };
    return { ok: true, resource };
  } catch (error) {
    const reason = error instanceof Error
      ? (error.name === 'AbortError' ? `超时（${deps.timeoutMs / 1000}s）` : error.message)
      : String(error);
    return { ok: false, error: `取回 ${url} 失败：${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 本地文件 → 统一资源输入（File.arrayBuffer 在浏览器/WebView 都可用） */
export async function resourceFromFile(file: {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<ResourceInput> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // 用文件的原始 type 判定；不把规范化后的 mimeType 反喂给 sniff
  const kind = sniffResourceKind(bytes, file.type);
  return {
    bytes,
    mimeType: resolveMimeType(bytes, file.type, kind),
    kind,
    label: file.name || '本地文件',
  };
}

