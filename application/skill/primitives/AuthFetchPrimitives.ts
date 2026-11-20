/**
 * 通用带凭据的 HTTP 直连原语
 * @module application/skill/primitives/AuthFetchPrimitives
 *
 *   http_fetch_auth(url, secretKey) → 宿主按 secretKey 查「已启用配方」声明的规格
 *     ├─ 规格不存在 / host 不在 allowedHosts → 拒绝，不发任何请求、不读凭据
 *     ├─ 凭据未保存 / 命中 reauthStatuses（默认 401）→ ok:false + secret-prompt:<key> 链接
 *     │    模型只把链接原样贴给用户，不索要、猜测、复述明文，不改 URL 重试
 *     └─ 正常 → 宿主 readRaw('secrets', key) 拼 `<header.name>: <prefix><token>`，
 *              按 spec.method 发 GET 或 POST（POST 时把 URL query 里白名单内的键
 *              搬进 JSON body），端侧直连 fetch；观察只回 HTTP 状态 + 预览，
 *              完整正文写 WebFetchCache
 *
 *   secret_prompt(secretKey) → 无论是否已配置都回同一条链接（「修改也弹框」）。
 *
 * **安全边界（宿主强制，模型无法绕过）**：模型参数只有 url 与 secretKey。
 * `allowedHosts` / header 名与前缀 / method / body 形状 / 重认证状态码全部来自
 * 配方声明，由宿主在装配期汇总进 SecretSpecRegistry；运行时模型传不进来，也
 * 就无法把某个 token 发到别的站点、改 header 拼法、或扩张 POST body 的字段。
 * 规格表里没有的 key 一律拒绝。工具签名始终只有 url + secretKey 两个参数。
 *
 * 「下次不再弹框」不靠状态位：凭据存在且服务端不再返回重认证状态时，调用直接成功。
 * 链接是消息里的 markdown（`[🔑 …](secret-prompt:…)`），宿主用 document 事件委托
 * 接管（同 secret-prompt:）。不走 ToolOutcome.actionLink：AssistantRenderer.resolvePath
 * 会把自定义 scheme 改写成站内路径，只有 markdown 链接能原样落到 DOM。
 *
 * 边界：
 * - 只 HTTPS 绝对 URL；GET（缺省）或 POST（配方显式声明）；禁 userinfo / 端口 /
 *   片段；host 精确匹配规格白名单。POST 的 body 只由配方静态字段 + URL query
 *   白名单键合成，不含凭据。
 * - 不带浏览器 cookie（credentials:'omit'）、不写缓存（cache:'no-store'）。
 * - token 只在宿主内存里活到 fetch 完成，不进观察 / 缓存 / 日志 / 会话历史。
 * - 数值出处：观察长度与预览取 CONTEXT_LIMITS.maxCharsPerMessage；请求超时取宿主
 *   已配置的 timeoutMs；重认证默认状态 401 = RFC 7235 Unauthorized 语义。
 */
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import {
  defaultWebFetchCache, type CachedWebResource, type WebFetchCache,
} from '@application/chat/WebFetchCache';
import type { SecretSpec } from '@application/skill/SecretSpec';
import type { KvService } from '../kv/KvService';

export const HTTP_FETCH_AUTH_TOOL_NAME = 'http_fetch_auth';
export const SECRET_PROMPT_TOOL_NAME = 'secret_prompt';
export const SECRET_PROMPT_SCHEME = 'secret-prompt:';

export const HTTP_FETCH_AUTH_TOOL: ModelToolDefinition = {
  name: HTTP_FETCH_AUTH_TOOL_NAME,
  description:
    '带凭据的 HTTPS 直连（GET 或 POST 由配方声明决定，缺省 GET）。只传 url 和 secretKey（配方里声明的凭据名）；'
    + '允许访问哪些域名、请求头怎么拼、用哪个 HTTP 方法、POST body 的形状、哪些状态码算凭据失效，'
    + '全部由宿主按已启用配方决定，模型不能指定。'
    + 'POST 时把 url 的 query 参数按配方白名单搬进 JSON body（如 ?query=… → body.query），'
    + '其余参数由配方写成固定值，模型改不了；url 里多余的 query 参数一律丢弃。'
    + '认证由宿主自动完成，模型拿不到也传不了任何密钥、请求头或 body 字段。'
    + '返回 HTTP 状态与正文预览；完整正文存入宿主缓存，用 web_cache_read（url 填本观察里的 URL，'
    + 'mode=slice 分页 / mode=grep 查找）继续读，未显示的部分绝不能凭猜测补写。'
    + '若凭据未配置或已失效，会返回一条配置链接：只把链接原样贴给用户并结束本轮，'
    + '不要索要、猜测或复述任何密钥，也不要自己改 URL 重试。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要请求的 https 绝对 URL，host 必须在当前配方声明的允许列表内；POST 配方把 query 参数当搜索词输入（见配方说明）' },
      secretKey: { type: 'string', description: '配方 secrets 里声明的凭据 key，如 github_token' },
    },
    required: ['url', 'secretKey'],
    additionalProperties: false,
  },
};

export const SECRET_PROMPT_TOOL: ModelToolDefinition = {
  name: SECRET_PROMPT_TOOL_NAME,
  description:
    '当用户说要换 / 修改 / 重新配置某个凭据时调用，返回一条配置链接让用户录入新值。'
    + '无论当前是否已配置都会弹框（修改场景）。只把返回的链接原样贴给用户，'
    + '不要索要、猜测或复述任何密钥。',
  parameters: {
    type: 'object',
    properties: {
      secretKey: { type: 'string', description: '配方 secrets 里声明的凭据 key' },
    },
    required: ['secretKey'],
    additionalProperties: false,
  },
};

/** 宿主装配期建好的规格查表；模型运行时只能按 key 查，不能写入 */
export interface SecretSpecRegistry {
  get(key: string): SecretSpec | undefined;
  /** 生成配置链接时校验 key 确实存在（防止模型编一个 key 骗弹框） */
  has(key: string): boolean;
  /** 仅宿主装配层调用：每轮用「已启用配方」全量刷新，模型无法触达 */
  replace(specs: readonly SecretSpec[]): void;
}

/**
 * 建表；装配期传空数组即可，之后由 ChatPage 的 loadSkills() 每轮刷新。
 * 规格只能来自本地技能库里已启用的配方，绝不从模型参数 / 在线任意内容注入。
 */
export function createSecretSpecRegistry(specs: readonly SecretSpec[] = []): SecretSpecRegistry {
  let map = new Map<string, SecretSpec>();
  const fill = (list: readonly SecretSpec[]): void => {
    const next = new Map<string, SecretSpec>();
    for (const s of list) next.set(s.key, s);
    map = next;
  };
  fill(specs);
  return {
    get: (k) => map.get(k),
    has: (k) => map.has(k),
    replace: (list) => fill(list),
  };
}

export interface AuthFetchPrimitivesDeps {
  kv: Pick<KvService, 'readRaw'>;
  specs: SecretSpecRegistry;
  cache?: WebFetchCache;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs: number;
}

/** host 白名单 + URL 形状校验；返回规范化 URL */
export function validateAuthUrl(raw: string, spec: SecretSpec): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('URL 格式不合法'); }
  if (u.protocol !== 'https:') throw new Error('只允许 https');
  if (u.username || u.password || u.port || u.hash) {
    throw new Error('URL 不允许带用户名 / 端口 / 片段');
  }
  const host = u.hostname.toLowerCase();
  if (!spec.allowedHosts.includes(host)) {
    throw new Error(`该凭据只允许发往 ${spec.allowedHosts.join(' / ')}，收到 ${host}`);
  }
  return u.toString();
}

/**
 * 由「已校验的 URL + 配方规格」构造真实请求。POST 的 body 只取配方白名单里的
 * query 键 + 配方静态字段；静态字段后写，保证模型无法用 query 覆盖固定值。
 * 返回 requestUrl 也只保留白名单内的 query，其余参数不发给对端。
 */
export interface AuthRequestShape {
  requestUrl: string;
  method: 'GET' | 'POST';
  /** JSON 字符串，仅 POST 有 */
  body?: string;
}

export function buildAuthRequest(rawUrl: string, spec: SecretSpec): AuthRequestShape {
  const url = validateAuthUrl(rawUrl, spec);
  const method = spec.method ?? 'GET';
  if (method === 'GET') return { requestUrl: url, method };

  const parsed = new URL(url);
  const kept = new URLSearchParams();
  const fromQuery: Record<string, unknown> = {};
  for (const key of spec.bodyQueryParams ?? []) {
    const value = parsed.searchParams.get(key);
    if (value !== null) {
      kept.set(key, value);
      fromQuery[key] = value;
    }
  }
  const body = { ...fromQuery, ...(spec.bodyStatic ?? {}) };
  const qs = kept.toString();
  const requestUrl = `${parsed.origin}${parsed.pathname}${qs ? `?${qs}` : ''}`;
  return { requestUrl, method, body: JSON.stringify(body) };
}

function promptLink(key: string, label: string): string {
  return `[🔑 配置 / 修改${label}](${SECRET_PROMPT_SCHEME}${key})`;
}

function needSecretObservation(spec: SecretSpec, reason: string): PrimitiveResult {
  const observation =
    `http_fetch_auth：${reason}。\n`
    + '请只把下面这条链接原样贴给用户，然后结束本轮回复：\n\n'
    + promptLink(spec.key, spec.label) + '\n\n'
    + '凭据由用户在弹框里录入并自动保存，宿主会记住，下次无需再配。'
    + '不要索要、猜测、复述或记录任何明文，也不要改 URL 重试。';
  return { observation, ok: false, detail: reason };
}

/** 正文预览：与 web_fetch 同一口径（同一常量、同一固定点迭代） */
function previewObservation(url: string, response: Response, text: string): string {
  const contentType = response.headers.get('content-type') ?? '';
  const lineCount = text.split('\n').length;
  const head = `http_fetch_auth：${url}\n`
    + `HTTP ${response.status} ${response.statusText}\n`
    + `Content-Type: ${contentType}\n`
    + `完整正文 ${text.length} 字符 / ${lineCount} 行，已存入宿主缓存。\n`
    + `其余内容请用 web_cache_read 读取（url 填上面的 URL，mode=slice 分页 / mode=grep 查找）；`
    + `不要凭预览猜测未显示的部分。\n\n`;
  const foot = (n: number): string =>
    `\n\n[预览 ${n} / ${text.length} 字符`
    + (n < text.length ? '；未到末尾，用 web_cache_read 继续读]' : '；正文已全部显示]');
  let previewLength = Math.max(0, CONTEXT_LIMITS.maxCharsPerMessage - head.length - foot(0).length);
  for (let i = 0; i < 8; i++) {
    const next = Math.max(0, CONTEXT_LIMITS.maxCharsPerMessage - head.length - foot(previewLength).length);
    if (next === previewLength) break;
    previewLength = next;
  }
  const body = text.slice(0, previewLength);
  return head + body + foot(body.length);
}

/** 只读准备动作：模型还没对数据做实质处理，不消耗 ToolLoop 自主决策预算 */
const PREPARATORY = true;

export function createAuthFetchPrimitives(deps: AuthFetchPrimitivesDeps): SkillPrimitive[] {
  const cache = deps.cache ?? defaultWebFetchCache;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  return [
    {
      name: HTTP_FETCH_AUTH_TOOL_NAME,
      definition: HTTP_FETCH_AUTH_TOOL,
      execute: async (argsJson): Promise<PrimitiveResult> => {
        const args = (() => {
          try { return JSON.parse(argsJson) as Record<string, unknown>; }
          catch { return {} as Record<string, unknown>; }
        })();
        const secretKey = args['secretKey'];
        if (typeof secretKey !== 'string' || !secretKey.trim()) {
          return { observation: 'http_fetch_auth 参数无效：缺少 secretKey。', ok: false, detail: '缺少 secretKey' };
        }
        // 规格查表：只认装配期汇总的配方声明，模型无法扩张白名单 / 改 header。
        const spec = deps.specs.get(secretKey.trim());
        if (!spec) {
          return {
            observation: `http_fetch_auth：未知凭据 ${secretKey}。当前已启用配方里没有声明它，宿主不会发送任何请求。`,
            ok: false, detail: `未知凭据 ${secretKey}`,
          };
        }
        let request: AuthRequestShape;
        try {
          const raw = args['url'];
          if (typeof raw !== 'string' || !raw.trim()) throw new Error('缺少 url 参数');
          request = buildAuthRequest(raw.trim(), spec);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return {
            observation: `http_fetch_auth 参数无效：${reason}。请给出该凭据允许域名下的 https 绝对 URL。`,
            ok: false, detail: `参数无效：${reason}`,
          };
        }
        const url = request.requestUrl;

        // 宿主侧读明文：这条路径不经过模型、不进会话历史、不落日志。
        let token: unknown;
        try {
          token = await deps.kv.readRaw('secrets', spec.key);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return {
            observation: `http_fetch_auth 读取本地凭据失败：${reason}。`,
            ok: false, detail: '读取本地凭据失败',
          };
        }
        if (typeof token !== 'string' || !token.trim()) {
          return needSecretObservation(spec, `${spec.label} 尚未配置`);
        }

        const reauth = spec.reauthStatuses ?? [401];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
        try {
          // header 只由配方拼；POST 时额外加 Content-Type，body 里绝不含凭据。
          const headers: Record<string, string> = {
            [spec.header.name]: `${spec.header.prefix}${token.trim()}`,
          };
          if (request.method === 'POST') headers['Content-Type'] = 'application/json';
          const init: RequestInit = {
            method: request.method,
            headers,
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'omit', // 只带宿主拼的 header，绝不带浏览器 cookie
            ...(request.body !== undefined ? { body: request.body } : {}),
          };
          const response = await fetchImpl(url, init);

          if (reauth.includes(response.status)) {
            await response.text().catch(() => '');
            return needSecretObservation(
              spec,
              `服务端返回 ${response.status}，${spec.label} 可能已失效或权限不足，请重新配置`,
            );
          }

          const text = await response.text();
          const contentType = response.headers.get('content-type') ?? '';
          const entry: CachedWebResource = {
            url, status: response.status, statusText: response.statusText,
            contentType, text, ok: response.ok,
          };
          cache.put(url, entry);
          return {
            observation: previewObservation(url, response, text),
            ok: response.ok,
            detail: `${url} → HTTP ${response.status}，${text.length} 字符（已缓存）`,
            preparatory: PREPARATORY,
          };
        } catch (error) {
          const reason = error instanceof Error
            ? (error.name === 'AbortError' ? `超时（${deps.timeoutMs / 1000}s）` : error.message)
            : String(error);
          return {
            observation: `http_fetch_auth 访问 ${url} 失败：${reason}。可能是网络不通或 CORS 被拦；不要猜测正文内容。`,
            ok: false, detail: `访问失败：${reason}`,
          };
        } finally {
          clearTimeout(timer);
        }
      },
    },
    {
      name: SECRET_PROMPT_TOOL_NAME,
      definition: SECRET_PROMPT_TOOL,
      execute: async (argsJson): Promise<PrimitiveResult> => {
        const args = (() => {
          try { return JSON.parse(argsJson) as Record<string, unknown>; }
          catch { return {} as Record<string, unknown>; }
        })();
        const key = args['secretKey'];
        if (typeof key !== 'string' || !deps.specs.has(key.trim())) {
          return {
            observation: `secret_prompt：未知凭据 ${String(key)}。当前已启用配方里没有声明它。`,
            ok: false, detail: `未知凭据 ${String(key)}`,
          };
        }
        const spec = deps.specs.get(key.trim())!;
        return {
          observation:
            '请只把下面这条链接原样贴给用户，然后结束本轮回复：\n\n'
            + promptLink(spec.key, spec.label) + '\n\n'
            + '用户会在弹框里录入新值并自动保存（已有值会被覆盖，弹框会提示当前值的末 4 位）。'
            + '不要索要、猜测、复述或记录任何明文。',
          ok: true,
          detail: `指路 ${spec.label} 配置弹框`,
          preparatory: PREPARATORY,
        };
      },
    },
  ];
}
