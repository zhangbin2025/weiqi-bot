/**
 * 远程插件清单客户端（纯逻辑，浏览器 API 通过依赖注入）
 * @module services/plugin-catalog/PluginCatalogClient
 *
 * 只做三件事：取 registry.json → 逐条取 manifest → 逐条取源码。
 * 不做安装、不碰工件存储、不碰 DOM。所有相对路径用 new URL(rel, base) 解析，
 * 并断言与清单同源：阻止 `..` 越界与 `https://evil.com/...` 外链。
 *
 * 失败语义：单个条目失败不影响其它条目；整个源失败交由调用方合并 failures。
 * 不引入超时/重试/阈值等经验常数——网络层由浏览器 fetch 自身决定，
 * 这里只把「拿不到」如实上报（守「数值有出处」约定）。
 */

import { validateRegistryUrl } from './PluginCatalogUrl';
import type { RegistryResource, PluginManifest } from './PluginCatalogTypes';

export interface PluginCatalogClientDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
}

/** 一条清单里能安全解析出的资源条目（附带已验证的 manifest 绝对 URL） */
export interface ParsedRegistryResource {
  resource: RegistryResource;
  manifestUrl: string;
  baseUrl: string;
}

export interface ParsedRegistry {
  registryUrl: string;
  baseUrl: string;
  resources: ParsedRegistryResource[];
}

export class PluginCatalogClient {
  private readonly fetchImpl: typeof fetch;

  constructor(deps: PluginCatalogClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * 取并校验顶层清单。
   * - URL 先过 validateRegistryUrl（https + 拒绝环回/私网字面地址）
   * - schemaVersion 不是 1 直接拒（宿主只认这一版格式）
   * - baseUrl 缺省时用「清单 URL 所在目录」兜底，避免自定义源漏配这一项
   * - noStore=true（手动刷新）时给底层 fetch 加 cache:'no-store'，绕过浏览器/CDN 的
   *   HTTP 缓存；正常打开面板仍走默认缓存语义。三个请求共用同一开关。
   */
  async fetchRegistry(registryUrl: string, noStore = false): Promise<ParsedRegistry> {
    const safeUrl = validateRegistryUrl(registryUrl);
    const text = await this.getText(safeUrl, noStore);
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error('registry.json 不是对象');
    if (parsed['schemaVersion'] !== 1) {
      throw new Error(`不认识的 schemaVersion：${String(parsed['schemaVersion'])}（宿主只支持 1）`);
    }
    const rawResources = parsed['resources'];
    if (!Array.isArray(rawResources)) throw new Error('registry.json.resources 必须是数组');

    const base = resolveBaseUrl(safeUrl, parsed['baseUrl']);
    const resources: ParsedRegistryResource[] = [];
    for (const raw of rawResources) {
      const resource = toRegistryResource(raw);
      const rel = typeof resource.path === 'string' ? resource.path : '';
      // 路径非法只跳过该条，不让整份清单失效
      if (!rel) continue;
      try {
        const manifestUrl = resolveSameOrigin(rel, base, safeUrl);
        resources.push({ resource, manifestUrl, baseUrl: base });
      } catch {
        // 越界/外链条目直接忽略（等价于「该条不可用」）
      }
    }
    return { registryUrl: safeUrl, baseUrl: base, resources };
  }

  /** 取 plugin.json：形状校验 + 与 registry 条目的 id / pointId / specVersion 对齐 */
  async fetchManifest(
    item: ParsedRegistryResource,
    noStore = false,
  ): Promise<{ manifest: PluginManifest; codeUrl: string }> {
    const text = await this.getText(item.manifestUrl, noStore);
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error('plugin.json 不是对象');

    const manifest: PluginManifest = {
      id: requireString(parsed, 'id'),
      name: requireString(parsed, 'name'),
      type: requireString(parsed, 'type'),
      pointId: requireString(parsed, 'pointId'),
      specVersion: requireInteger(parsed, 'specVersion'),
      entry: requireString(parsed, 'entry'),
      code: requireString(parsed, 'code'),
      origin: parsed['origin'] === 'llm' ? 'llm' : 'manual',
      intent: requireString(parsed, 'intent'),
    };
    // llm-tool 的可选契约字段：宽松解析，逐条校验由 validate.mjs 在发布侧把关，
    // 宿主侧使用时再逐项检查；未知字段一律不进类型。
    const exposures = parsed['exposes'];
    if (Array.isArray(exposures)) {
      manifest.exposes = exposures.filter(isRecord).map((e) => ({
        name: typeof e['name'] === 'string' ? e['name'] : '',
        description: typeof e['description'] === 'string' ? e['description'] : '',
        params: isRecord(e['params']) ? e['params'] : {},
      }));
    }
    const smoke = parsed['smoke'];
    if (Array.isArray(smoke)) {
      manifest.smoke = smoke.filter(isRecord).map((s) => {
        const c: { method?: string; args: unknown[]; expect: unknown } = {
          args: Array.isArray(s['args']) ? s['args'] : [],
          expect: s['expect'],
        };
        if (typeof s['method'] === 'string') c.method = s['method'];
        return c;
      });
    }
    if (typeof parsed['category'] === 'string') manifest.category = parsed['category'];
    if (manifest.type !== 'plugin') throw new Error('type 不是 plugin');
    if (item.resource.id !== undefined && manifest.id !== item.resource.id) {
      throw new Error('manifest.id 与 registry 条目不一致');
    }
    if (item.resource.pointId !== undefined && manifest.pointId !== item.resource.pointId) {
      throw new Error('manifest.pointId 与 registry 条目不一致');
    }
    if (item.resource.specVersion !== undefined && manifest.specVersion !== item.resource.specVersion) {
      throw new Error('manifest.specVersion 与 registry 条目不一致');
    }

    const codeUrl = resolveSameOrigin(manifest.code, item.baseUrl, item.manifestUrl);
    return { manifest, codeUrl };
  }

  /** 取源码正文；不执行、不求值，只作为字符串交给宿主校验 */
  async fetchCode(codeUrl: string, noStore = false): Promise<string> {
    return this.getText(codeUrl, noStore);
  }

  private async getText(url: string, noStore: boolean): Promise<string> {
    const res = noStore
      ? await this.fetchImpl(url, { cache: 'no-store' })
      : await this.fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  }
}

// ---------- 内部纯函数（导出供单测直接断言） ----------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`缺少字段 ${key}`);
  return v;
}

function requireInteger(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(`字段 ${key} 必须是 >=1 的整数`);
  }
  return v;
}

/** 未知字段不进类型，避免把自定义源的额外元数据带进宿主逻辑 */
function toRegistryResource(raw: unknown): RegistryResource {
  if (!isRecord(raw)) return {};
  const r: RegistryResource = {};
  if (typeof raw['id'] === 'string') r.id = raw['id'];
  if (typeof raw['type'] === 'string') r.type = raw['type'];
  if (typeof raw['name'] === 'string') r.name = raw['name'];
  if (typeof raw['summary'] === 'string') r.summary = raw['summary'];
  if (typeof raw['path'] === 'string') r.path = raw['path'];
  if (typeof raw['pointId'] === 'string') r.pointId = raw['pointId'];
  if (typeof raw['specVersion'] === 'number') r.specVersion = raw['specVersion'];
  if (typeof raw['category'] === 'string') r.category = raw['category'];
  return r;
}

/**
 * 清单基准：优先 registry.baseUrl；否则用清单 URL 的目录。
 * baseUrl 必须与清单 URL 同源（GitHub Pages / 自建静态站都在同一 origin）。
 */
export function resolveBaseUrl(registryUrl: string, rawBaseUrl: unknown): string {
  const fallback = new URL('.', registryUrl).toString();
  if (typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) return fallback;
  let candidate: URL;
  try {
    candidate = new URL(rawBaseUrl, registryUrl);
  } catch {
    return fallback;
  }
  const origin = new URL(registryUrl).origin;
  if (candidate.origin !== origin) {
    throw new Error('registry.baseUrl 与清单不同源，拒绝拼接');
  }
  // 规范化为带尾斜杠的目录 URL，new URL(rel, base) 才不会丢掉最后一段
  if (!candidate.pathname.endsWith('/')) candidate.pathname += '/';
  return candidate.toString();
}

/**
 * 把资源相对路径解析成绝对 URL，并断言与「清单来源」同源。
 * 引用 URL 允许是条目自身（manifest 的 code），用于计算同源判定的锚点。
 */
export function resolveSameOrigin(rel: string, base: string, anchorUrl: string): string {
  if (rel.startsWith('/') || rel.includes('\\')) {
    throw new Error(`路径不是仓库内相对路径：${rel}`);
  }
  // 与 weiqi-assets/scripts/validate.mjs 的 safePath 同源：路径段里出现 ..
  // 一律拒（即使 new URL 解析后仍在同一 origin，也可能跳出资源目录读到别的文件）。
  if (rel.split('/').includes('..')) {
    throw new Error(`路径含 .. 越界：${rel}`);
  }
  let resolved: URL;
  try {
    resolved = new URL(rel, base);
  } catch {
    throw new Error(`路径无法解析：${rel}`);
  }
  const allowed = new URL(anchorUrl).origin;
  if (resolved.origin !== allowed) throw new Error(`路径指向站外：${rel}`);
  // 与源 URL 同口径：https + 无环回/私网字面地址（见 PluginCatalogUrl.ts）
  return validateRegistryUrl(resolved.toString());
}
