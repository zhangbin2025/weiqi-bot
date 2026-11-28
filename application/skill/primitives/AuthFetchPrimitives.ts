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
import type { SkillPrimitive, PrimitiveResult, WorkflowStep } from '@application/skill/SkillTypes';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import {
  defaultWebFetchCache, type CachedWebResource, type WebFetchCache,
} from '@application/chat/WebFetchCache';
import type { SecretSpec } from '@application/skill/SecretSpec';
import { HOST_WORKFLOW_OPERATOR_NAMESPACES } from '@application/skill/HostWorkflowNamespaces';
import type { KvService } from '../kv/KvService';
import type { UserSkillStore } from '@application/skill/dev/UserSkillStore';
import { WORKFLOW_OPERATOR_POINT_ID, resolvePluginSpec, type PluginArtifact } from '@domain/plugin/types';
import { WEIQI_ASSETS_BASE_URL } from '@services/share/WeiqiAssetsUrls';

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
  // 浏览器原生 window.fetch 是 WebIDL 方法：把函数引用取出来裸调、或当普通对象的方法调，
  // this 不是 Window 就会抛 "Failed to execute 'fetch' on 'Window': Illegal invocation"。
  // 与 SkillCatalogClient / PluginCatalogClient 同口径，默认实现显式 bind(globalThis)；
  // 注入的 fetchImpl 是测试桩（普通函数），原样使用，不 bind 出副本以免影响 spy 身份。
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return [
    {
      name: HTTP_FETCH_AUTH_TOOL_NAME,
      definition: HTTP_FETCH_AUTH_TOOL,
      idempotent: true,
      outputSchema: {},
      kind: 'io',
      execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => {
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
      idempotent: true,
      outputSchema: {},
      kind: 'effect',
      execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => {
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


/* ==========================================================================
 * 发布原语（宿主原子接口，两个）
 *
 * 设计边界（用户定稿）：发布 = weiqi-assets 里一份独立管理者技能 + 宿主只给
 * 「读本地资源 + 写 GitHub」两个原子接口。这里不做 Service / 编排 / 新面板 /
 * PR 分支流程 / 独立 token / 发布前确认 UI。模型只给意图级参数（kind / id /
 * handle / message），文件内容、header、base64 全由宿主拼；模型全程不碰代码
 * 正文、不碰 token 明文。凭据仍由 admin.publish 配方的 secrets 声明，走
 * secret_prompt 弹框；本原语不放宽 SecretSpec 的 GET/POST 限制、不走
 * http_fetch_auth —— 那条链路的模型只能给 url + secretKey，承载不了动态文件。
 *
 * 放在本文件而非新建模块：长驻 vite dev 对「新建 .ts」的 import 解析有缓存坑
 * （见 ChatPage.ts 的 EXTENSION_CATEGORIES 注释），ChatPage 已 import 本模块，
 * 加具名导出不新增 import 路径 = 零坑。
 * ========================================================================== */

export const ASSET_EXPORT_TOOL_NAME = 'asset_export';
export const GITHUB_PUBLISH_FILE_TOOL_NAME = 'github_publish_file';

/** GitHub 官方 REST API 根（公开端点，出处：docs.github.com/rest）；与 admin.publish 的 secrets.allowedHosts 同 host。 */
const GITHUB_API_ROOT = 'https://api.github.com';

export const ASSET_EXPORT_TOOL: ModelToolDefinition = {
  name: ASSET_EXPORT_TOOL_NAME,
  description:
    '导出一条本地自建技能（或 workflow 算子插件）成 weiqi-assets 的完整变更集，返回句柄与摘要。'
    + '这是发布前的预览：只把句柄和摘要（将写哪些路径、各多少字节、是否含依赖算子插件）如实转述给用户，'
    + '不要复述文件正文。带 workflow 的技能会自动连同它 call 的 <slug>.<method> 对应的算子插件一起纳入。'
    + '本步不写任何外部状态；用户下一条消息明确确认后再调 github_publish_file 提交。',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['skill', 'plugin'], description: '要导出的本地资源类型' },
      id: { type: 'string', description: '资源 id：技能用 skill_list 里的 id；插件用 plugin_list 里的 artifactId' },
    },
    required: ['kind', 'id'],
    additionalProperties: false,
  },
};

export const GITHUB_PUBLISH_FILE_TOOL: ModelToolDefinition = {
  name: GITHUB_PUBLISH_FILE_TOOL_NAME,
  description:
    '把 asset_export 给的句柄对应变更集直接提交到 weiqi-assets 默认分支固定路径（不建分支、不发 PR，Pages 立即公开）。'
    + '只在用户下一条消息明确确认发布后调用。凭据由宿主在本机 secrets 域读取，模型永远接触不到明文；'
    + '首次 / 401 会回一条 secret-prompt:github_token 链接，只原样贴给用户并结束本轮。'
    + '返回每个文件的 HTTP 状态与 commit，不含正文 / 不含凭据。',
  parameters: {
    type: 'object',
    properties: {
      handle: { type: 'string', description: 'asset_export 返回的句柄' },
      message: { type: 'string', description: '可选：一句意图明确的提交说明' },
    },
    required: ['handle'],
    additionalProperties: false,
  },
};

export interface PublishPrimitivesDeps {
  kv: Pick<KvService, 'readRaw'>;
  /** 已启用配方汇总的凭据规格表：只用来取 github_token 的 label 生成弹框链接 */
  specs: SecretSpecRegistry;
  userSkills: Pick<UserSkillStore, 'list'>;
  /** 插件工件存储；装配失败时可为 undefined（此时只导出技能，找不到依赖算子就报错） */
  artifacts?: { list(): Promise<PluginArtifact[]> } | undefined;
  timeoutMs: number;
  fetchImpl?: typeof globalThis.fetch;
}

interface PublishFile {
  path: string;
  /** 普通文件：完整 UTF-8 正文；索引文件：空串（正文在 PUT 前由宿主合并生成） */
  content: string;
  /** 索引文件：PUT 前先 GET 现有 JSON，把 entry 按 id 并进 listKey 数组再写 */
  merge?: { listKey: 'skills' | 'resources'; entry: Record<string, unknown> };
}

interface PublishBundle {
  handle: string;
  files: PublishFile[];
  /** 一并纳入的 workflow 算子插件 resourceId（摘要里如实列出，不凭记忆补写） */
  includesPlugins: string[];
}

/** 进程内句柄缓存：预览 → 用户下一条消息确认 → 提交，都在同一页面会话里完成。 */
const publishBundles = new Map<string, PublishBundle>();

function isPublishRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    const v: unknown = args;
    return isPublishRecord(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * 从 Workflow DAG 收集需要随技能发布的插件命名空间。
 * HOST_WORKFLOW_OPERATOR_NAMESPACES 里的宿主原生算子不对应 assets 插件工件；
 * 与安装侧 skillPluginResourceIds() 共用同一份集合，避免两处清单漂移。
 */
export function collectWorkflowDependencyNamespaces(
  steps: readonly WorkflowStep[] | undefined,
): string[] {
  const slugs = new Set<string>();
  const collect = (items: readonly WorkflowStep[] | undefined): void => {
    for (const step of items ?? []) {
      if (typeof step.call === 'string') {
        const dot = step.call.indexOf('.');
        if (dot > 0) {
          const namespace = step.call.slice(0, dot);
          if (!HOST_WORKFLOW_OPERATOR_NAMESPACES.has(namespace)) slugs.add(namespace);
        }
      }
      collect(step.forEach?.steps);
      collect(step.repeat?.steps);
      collect(step.ifElse?.then);
      collect(step.ifElse?.else);
    }
  };
  collect(steps);
  return [...slugs];
}

/**
 * 技能 → 变更集。瘦索引条目的字段来自 weiqi-assets/scripts/validate.mjs 的
 * SKILL_OVERLAP_FIELDS（id/version/name/summary/routeHint/primitives/category）
 * + path（`<id>/skill.json`）；顶层保持 schemaVersion:2，由 PUT 前 GET 的现有
 * 清单原样带过来，宿主不捏造 name / description / baseUrl。
 */
async function buildSkillBundle(deps: PublishPrimitivesDeps, id: string): Promise<PublishBundle> {
  const entries = await deps.userSkills.list();
  const entry = entries.find((e) => e.recipe.id === id);
  if (!entry) throw new Error(`本地技能 ${id} 不存在；先用 skill_list 确认 id`);
  const r = entry.recipe;
  const dir = `skills/${id}`;
  const files: PublishFile[] = [
    { path: `${dir}/skill.json`, content: `${JSON.stringify(r, null, 2)}\n` },
  ];
  const indexEntry: Record<string, unknown> = {
    id: r.id, version: r.version, name: r.name, summary: r.summary,
    primitives: r.primitives, path: `${id}/skill.json`,
    ...(r.routeHint !== undefined ? { routeHint: r.routeHint } : {}),
    ...(r.category !== undefined ? { category: r.category } : {}),
  };
  files.push({
    path: 'skills/registry.json', content: '',
    merge: { listKey: 'skills', entry: indexEntry },
  });

  // 只把真正由插件提供的命名空间作为发布依赖；宿主原生命名空间见共享集合。
  const slugs = new Set(collectWorkflowDependencyNamespaces(r.workflow?.steps));
  const artifacts = (await deps.artifacts?.list()) ?? [];
  const includesPlugins: string[] = [];
  for (const slug of slugs) {
    const a = artifacts.find((x) => x.slug === slug && x.pointId === WORKFLOW_OPERATOR_POINT_ID);
    if (!a) {
      throw new Error(`技能 ${id} 的 workflow 引用了算子命名空间 ${slug}，但本地找不到对应 `
        + `workflow-operator 插件（先用 plugin_list 确认它的 slug）；依赖算子必须与技能一起发布`);
    }
    files.push(...buildPluginFiles(a));
    includesPlugins.push(`${WORKFLOW_OPERATOR_POINT_ID}.${slug}`);
  }

  return { handle: `asset:skill:${id}`, files, includesPlugins };
}

/** 插件 → 变更集（plugin.json + index.js + 顶层 registry 索引条目）。 */
function buildPluginFiles(a: PluginArtifact): PublishFile[] {
  if (a.slug === undefined || !a.slug.trim()) {
    throw new Error(`插件 ${a.id} 还没有 slug；先用 plugin_write 给它一个稳定短名再发布`
      + '（生成式工件 id 不能进资源 id，也不能被 workflow.call 稳定引用）');
  }
  const slug = a.slug;
  const spec = resolvePluginSpec(a.pointId);
  if (!spec) throw new Error(`插件 ${a.id} 的扩展点 ${a.pointId} 不在宿主 PLUGIN_SPECS 里`);
  // workflow-operator 资源侧校验（weiqi-assets/scripts/validate.mjs 的 validateOperatorPlugin）
  // 要求 exposes[] / smoke[] 非空；缺契约就别发一个过不了校验的坏资源。
  if (a.pointId === WORKFLOW_OPERATOR_POINT_ID && a.operatorContract === undefined) {
    throw new Error(`插件 ${a.id} 缺算子契约（operatorContract / exposes / smoke）；`
      + '先用 plugin_write 试算产出契约再发布，否则资源侧校验会拒收');
  }
  const dir = `plugins/${a.pointId}/${slug}`;
  const resourceId = `${a.pointId}.${slug}`;
  const pluginJson: Record<string, unknown> = {
    $schema: '../../../schema/plugin.schema.json',
    id: resourceId, name: a.name, type: 'plugin', pointId: a.pointId,
    specVersion: spec.version, entry: spec.entry, code: `${dir}/index.js`,
    origin: a.origin, intent: a.intent,
    ...(a.category !== undefined ? { category: a.category } : {}),
    ...(a.operatorContract !== undefined
      ? { exposes: a.operatorContract.exposes, smoke: a.operatorContract.smoke } : {}),
  };
  const indexEntry: Record<string, unknown> = {
    id: resourceId, type: 'plugin', name: a.name, summary: a.intent,
    pointId: a.pointId, specVersion: spec.version, path: `${dir}/plugin.json`,
    ...(a.category !== undefined ? { category: a.category } : {}),
  };
  return [
    { path: `${dir}/plugin.json`, content: `${JSON.stringify(pluginJson, null, 2)}\n` },
    { path: `${dir}/index.js`, content: a.code },
    {
      path: 'registry.json', content: '',
      merge: { listKey: 'resources', entry: indexEntry },
    },
  ];
}

/** UTF-8 → base64：Web 标准 TextEncoder + btoa，不自造编码表、不引入经验常数。 */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** GitHub Contents GET 的 content 是带换行的 base64；按 Web 标准解回 UTF-8。 */
function decodeContentBase64(raw: string): string {
  const binary = atob(raw.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** GitHub Pages 项目站点固定形状 https://<owner>.github.io/<repo>/（出处：GitHub Pages 官方文档）。 */
function githubRepoFromPagesUrl(baseUrl: string): { owner: string; repo: string } {
  const u = new URL(baseUrl);
  const owner = u.hostname.split('.')[0] ?? '';
  const repo = u.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!owner || !repo) throw new Error('weiqi-assets 站点根不是 GitHub Pages 项目站点 URL');
  return { owner, repo };
}

class GithubStatusError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface GithubRequestCtx {
  fetchImpl: typeof globalThis.fetch;
  headers: Record<string, string>;
  timeoutMs: number;
}

async function ghFetch(ctx: GithubRequestCtx, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    // 别把 fetch 当 ctx 的方法调：那样 this 是普通对象，原生 fetch 会抛 Illegal invocation。
    // 显式 call(globalThis, …) 固定 receiver，注入未 bind 的实现也不会中招。
    return await ctx.fetchImpl.call(globalThis, url, {
      ...init,
      headers: ctx.headers,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit', // 只带宿主拼的 header，绝不带浏览器 cookie
    });
  } finally {
    clearTimeout(timer);
  }
}

interface GithubFileState {
  sha?: string;
  /** 索引文件：现有清单 JSON（GET 正文解码后） */
  body?: Record<string, unknown>;
}

async function githubGet(
  ctx: GithubRequestCtx, url: string, wantBody: boolean,
): Promise<GithubFileState> {
  const res = await ghFetch(ctx, url, { method: 'GET' });
  if (res.status === 404) return {};
  if (!res.ok) throw new GithubStatusError(res.status, `GET → HTTP ${res.status}`);
  const json = await res.json() as { sha?: unknown; content?: unknown };
  const state: GithubFileState = {};
  if (typeof json.sha === 'string') state.sha = json.sha;
  if (wantBody && typeof json.content === 'string') {
    state.body = JSON.parse(decodeContentBase64(json.content)) as Record<string, unknown>;
  }
  return state;
}

async function githubPut(
  ctx: GithubRequestCtx, url: string, body: Record<string, unknown>,
): Promise<{ status: number; commit: string }> {
  const res = await ghFetch(ctx, url, { method: 'PUT', body: JSON.stringify(body) });
  // 409 不当异常抛：调用方要按 GitHub 口径重取 sha 再提交一次。
  if (res.status === 409) return { status: 409, commit: '' };
  if (!res.ok) throw new GithubStatusError(res.status, `PUT → HTTP ${res.status}`);
  const json = await res.json() as { commit?: { sha?: unknown } };
  const sha = json.commit?.sha;
  return { status: res.status, commit: typeof sha === 'string' ? sha : '（无 commit 字段）' };
}

/** 索引按 id 合并：已有条目整条替换（同 id 版本更新），没有就追加；其余顶层字段原样保留。 */
function mergeIndex(
  body: Record<string, unknown>, listKey: 'skills' | 'resources', entry: Record<string, unknown>,
): Record<string, unknown> {
  const raw = Array.isArray(body[listKey]) ? body[listKey] as unknown[] : [];
  const list = [...raw];
  const at = list.findIndex((x) => isPublishRecord(x) && x['id'] === entry['id']);
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  return { ...body, [listKey]: list };
}

function contentApiUrl(owner: string, repo: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${GITHUB_API_ROOT}/repos/${owner}/${repo}/contents/${encoded}`;
}

/** 单个文件：GET sha（+ 索引正文）→ PUT；409 说明 sha 已过期，重取后再提交一次。 */
async function publishOne(
  ctx: GithubRequestCtx, owner: string, repo: string, file: PublishFile, message: string,
): Promise<string> {
  const url = contentApiUrl(owner, repo, file.path);
  const needBody = file.merge !== undefined;
  const prepare = async (): Promise<{ content: string; sha?: string }> => {
    const state = await githubGet(ctx, url, needBody);
    if (needBody && state.body === undefined) {
      throw new Error(`${file.path} 不存在或不是合法 JSON 清单；宿主不捏造顶层字段，请检查目标仓库`);
    }
    let content = file.content;
    if (file.merge !== undefined) {
      const merged = mergeIndex(state.body!, file.merge.listKey, file.merge.entry);
      content = `${JSON.stringify(merged, null, 2)}\n`;
    }
    return { content, ...(state.sha !== undefined ? { sha: state.sha } : {}) };
  };
  let prepared = await prepare();
  const bodyOf = (p: { content: string; sha?: string }): Record<string, unknown> => ({
    message, content: base64Utf8(p.content),
    ...(p.sha !== undefined ? { sha: p.sha } : {}),
    // 省略 branch：GitHub 用仓库默认分支（= 直提默认分支，不建分支 / PR）。
  });
  let result = await githubPut(ctx, url, bodyOf(prepared));
  if (result.status === 409) {
    // GitHub 要求 sha 必须匹配当前版本；409 说明期间仓库被改过，重取 sha 后再提交一次。
    prepared = await prepare();
    result = await githubPut(ctx, url, bodyOf(prepared));
  }
  if (result.status === 409) {
    throw new GithubStatusError(409, 'PUT → HTTP 409（重取 sha 后仍冲突）');
  }
  return `- ${file.path} → HTTP ${result.status}，commit ${result.commit}`;
}

function needPublishSecret(deps: PublishPrimitivesDeps, reason: string): PrimitiveResult {
  const label = deps.specs.get('github_token')?.label ?? 'GitHub Personal Access Token';
  return {
    observation:
      `github_publish_file：${reason}。\n\n`
      + '请只把下面这条链接原样贴给用户，然后结束本轮回复：\n\n'
      + promptLink('github_token', label) + '\n\n'
      + '凭据由用户在弹框里录入并自动保存，宿主会记住，下次无需再配。'
      + '不要索要、猜测、复述或记录任何明文，也不要自己改路径重试。',
    ok: false,
    detail: reason,
  };
}

export function createPublishPrimitives(deps: PublishPrimitivesDeps): SkillPrimitive[] {
  // 同上：默认 fetch 必须 bind(globalThis)。未 bind 时 ghFetch 里 ctx.fetchImpl(...) 会把
  // this 变成普通对象 ctx，浏览器在第一次 GET 就抛 Illegal invocation（发布中断）。
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return [
    {
      name: ASSET_EXPORT_TOOL_NAME,
      definition: ASSET_EXPORT_TOOL,
      idempotent: true,
      outputSchema: {},
      kind: 'effect',
      execute: async (rawArgs: Record<string, unknown>): Promise<PrimitiveResult> => {
        const args = parseArgs(rawArgs);
        const kind = args['kind'];
        const id = args['id'];
        if ((kind !== 'skill' && kind !== 'plugin') || typeof id !== 'string' || !id.trim()) {
          return {
            observation: 'asset_export 参数无效：kind 必须是 skill / plugin，id 必须是非空字符串。',
            ok: false, detail: '参数无效',
          };
        }
        let bundle: PublishBundle;
        try {
          if (kind === 'skill') {
            bundle = await buildSkillBundle(deps, id.trim());
          } else {
            const artifacts = (await deps.artifacts?.list()) ?? [];
            const a = artifacts.find((x) => x.id === id.trim());
            if (!a) throw new Error(`本地插件 ${id} 不存在；先用 plugin_list 确认 artifactId`);
            bundle = {
              handle: `asset:plugin:${id.trim()}`,
              files: buildPluginFiles(a),
              includesPlugins: [`${a.pointId}.${a.slug}`],
            };
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { observation: `asset_export 失败：${reason}`, ok: false, detail: `导出失败：${reason}` };
        }
        publishBundles.set(bundle.handle, bundle);
        const lines = bundle.files.map((f) => {
          if (f.merge !== undefined) return `- ${f.path} — 索引条目合并（id=${String(f.merge.entry['id'])}）`;
          const bytes = new TextEncoder().encode(f.content).length;
          return `- ${f.path} — ${bytes} 字节`;
        });
        const depsLine = bundle.includesPlugins.length > 0
          ? `\n依赖算子插件（已一并纳入）：${bundle.includesPlugins.join('、')}`
          : '\n依赖算子插件：无';
        return {
          observation:
            `asset_export：句柄 ${bundle.handle}\n`
            + '变更集预览（本步不写任何外部状态，提交前必须结束本轮、等用户下一条消息明确确认）：\n'
            + `${lines.join('\n')}${depsLine}\n\n`
            + '只把句柄与这段摘要如实转述给用户，不要复述文件正文；确认后再调 github_publish_file。',
          ok: true,
          detail: `导出 ${bundle.files.length} 个文件，句柄 ${bundle.handle}`,
          preparatory: PREPARATORY,
        };
      },
    },
    {
      name: GITHUB_PUBLISH_FILE_TOOL_NAME,
      definition: GITHUB_PUBLISH_FILE_TOOL,
      // 写外部仓库，非幂等；不让 OperatorRegistry 把它当纯计算算子。
      idempotent: false,
      outputSchema: {},
      kind: 'effect',
      execute: async (rawArgs: Record<string, unknown>): Promise<PrimitiveResult> => {
        const args = parseArgs(rawArgs);
        const handle = args['handle'];
        if (typeof handle !== 'string' || !handle.trim()) {
          return {
            observation: 'github_publish_file 参数无效：缺少 handle（先调 asset_export）。',
            ok: false, detail: '缺少 handle',
          };
        }
        const bundle = publishBundles.get(handle.trim());
        if (!bundle) {
          return {
            observation: `句柄 ${handle} 无效或已过期；请重新调 asset_export 生成新句柄。`,
            ok: false, detail: '句柄无效',
          };
        }
        let token: unknown;
        try {
          token = await deps.kv.readRaw('secrets', 'github_token');
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { observation: `读取本地凭据失败：${reason}`, ok: false, detail: '读取本地凭据失败' };
        }
        if (typeof token !== 'string' || !token.trim()) {
          return needPublishSecret(deps, 'github_token 尚未配置');
        }
        let owner: string;
        let repo: string;
        try {
          ({ owner, repo } = githubRepoFromPagesUrl(WEIQI_ASSETS_BASE_URL));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { observation: `目标仓库解析失败：${reason}`, ok: false, detail: '目标仓库解析失败' };
        }
        // Authorization 的字段名/前缀以 admin.publish 的 secrets 声明为唯一事实源；
        // 未启用该配方时退回 GitHub 官方口径（出处：docs.github.com/rest）。
        const tokenSpec = deps.specs.get('github_token');
        const ctx: GithubRequestCtx = {
          fetchImpl,
          headers: {
            // header 全由宿主拼，模型传不进来；token 只在内存里活到请求结束。
            [tokenSpec?.header.name ?? 'Authorization']:
              `${tokenSpec?.header.prefix ?? 'Bearer '}${token.trim()}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          timeoutMs: deps.timeoutMs,
        };
        const message = typeof args['message'] === 'string' && args['message'].trim()
          ? args['message'].trim()
          : `发布 ${bundle.handle} 到 weiqi-assets`;
        const done: string[] = [];
        try {
          for (const file of bundle.files) {
            done.push(await publishOne(ctx, owner, repo, file, message));
          }
        } catch (error) {
          if (error instanceof GithubStatusError && error.status === 401) {
            return needPublishSecret(deps, '服务端返回 401，github_token 可能已失效或权限不足');
          }
          const reason = error instanceof Error
            ? (error.name === 'AbortError' ? `超时（${deps.timeoutMs / 1000}s）` : error.message)
            : String(error);
          return {
            observation: `发布中断：${reason}。已成功提交的文件：${done.length ? `\n${done.join('\n')}` : '无'}。`,
            ok: false, detail: `发布中断：${reason}`,
          };
        }
        publishBundles.delete(handle.trim()); // 一份句柄只提交一次，避免误重复写
        return {
          observation:
            `已提交 ${bundle.files.length} 个文件到 ${owner}/${repo} 默认分支（Pages 随即公开）：\n`
            + `${done.join('\n')}\n\n`
            + '如实回报以上状态；403 限流不是凭据失效，不要叫用户重新配置。',
          ok: true,
          detail: `提交 ${bundle.files.length} 个文件到 ${owner}/${repo}`,
        };
      },
    },
  ];
}
