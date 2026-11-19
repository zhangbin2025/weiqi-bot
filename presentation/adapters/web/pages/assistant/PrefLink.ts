/**
 * 「使用偏好」场景的链接契约（单一出处）
 * @module presentation/adapters/web/pages/assistant/PrefLink
 *
 * 本地数据层两期场景刻意做成镜像：
 * - 第一期（凭据）：`secrets` 域 opaque / host 写。secret-prompt:<key> 链接由宿主
 *   接管，弹框直接 `kv.put('secrets', ...)`，明文永不过模型。
 * - 第二期（使用偏好）：`prefs` 域 readable / model 写。链接只回灌一条**用户消息**，
 *   宿主不碰存储；由 LLM 按技能配方指令自己调 kv_read / kv_write。宿主不替模型
 *   做决定，也不在链接里携带整份待写入的业务结构。
 *
 * 为什么走 markdown 链接 + document 事件委托，而不是 ToolOutcome.actionLink：
 * AssistantRenderer.resolvePath 会把自定义 scheme 改写成站内路径，只有 markdown
 * 链接能原样落到 DOM（与 event-table: / secret-prompt: 同款）。
 *
 * ## 2026-11-19 通用化：任何 skill 存用户数据都不再改宿主
 *
 * 旧 `stock-watch-add:<代码>` 把 scheme 名、股票代码正则、回灌文案全部写死在
 * 宿主里，天气 / 后续任何「加入自选」类技能都得再注册一个 scheme、再改一次
 * 事件委托与白名单，配方里还要抄一遍流程。
 *
 * 现在统一为 `prefs-add:<domain>:<key>:<value>`：
 * - 宿主**不认识任何业务键名**（weather.watchlist / stock.watchlist 仍由配方声明），
 *   只做形状校验 + 回灌一条用户消息，读写仍由 LLM 按当前技能配方完成；
 * - domain / key 复用 KvDomains / KvService 的既有合法形状（口径有出处，不新造）；
 * - value 用**明文**（如 北京 / sh600519），不做 percent 编码 —— 让 LLM 能按配方
 *   里的格式原样写对；只禁用 markdown / HTML 结构性危险字符；
 * - 新增技能要存偏好时，只需在配方里贴出这种链接并声明 domain/key，
 *   **不需要改宿主**。
 *
 * 旧 `stock-watch-add:` 仍保留（兼容历史会话里已渲染的旧链接），
 * 但新配方一律用通用 scheme。
 */

import { KV_DOMAIN_NAME_RE } from '../../../../../application/skill/kv/KvDomains';

/** 通用自定义 scheme：点击 = 请 LLM 按技能说明把一条值存入本地偏好 */
export const PREF_ADD_SCHEME = 'prefs-add:';

/** 旧 scheme（股票自选，仅历史链接兼容；新配方不要再使用） */
export const PREF_ADD_WATCH_SCHEME = 'stock-watch-add:';

/**
 * 键名形状：与 KvService 的 KV_KEY_RE 同源（字母数字 _ . -，长度上限沿用宿主
 * 单条键既有约束 128）。不是扫验证集挑出来的经验值，是复用既有事实。
 */
const PREF_KEY_RE = /^[A-Za-z0-9_.\-]{1,128}$/;

/**
 * value 禁用的字符：全部来自 markdown `[](...)` / HTML 属性的结构性语法，
 * 不是拟合阈值 ——
 * - `:` 本 scheme 的分隔符；`(` `)` `[` `]` markdown 定界；
 * - `[ \t\r\n]` 空白换行（markdown 与注入）；`<` `>` `"` `'` HTML 标签 / 属性引号；
 * - `%` 避免与 percent-encoding 歧义（明文所见即所得，不解码）；
 * - `#` `?` URL fragment / query，避免被当成链接语义。
 * 中文城市名、字母数字、逗号、横线、点都允许。
 */
const PREF_VALUE_FORBIDDEN_RE = /[:\s()\[\]<>"'%#?]/;

/**
 * 单条 href 总长上限：**协议层护栏**，防超长脏串回灌进会话；不是从验证集挑的
 * 经验阈值，也不参与任何业务判定。真正的单条 prefs 值配额由 KvService 在写入时兜底。
 */
const MAX_HREF_CHARS = 2048;

/** 单个标识的长度上限（同上，协议护栏）：值是一个标识，不是整份列表 / JSON / 正文 */
const MAX_VALUE_CHARS = 256;

/** 旧兼容路径的股票代码形状（与配方代码转换口径同源：市场前缀 + 位数） */
const STOCK_CODE_RE = /^(?:sh\d{6}|sz\d{6}|hk\d{5}|us[A-Za-z0-9.]{1,10})$/;

/** 通用 scheme 解析结果 */
export interface PrefAddTarget {
  domain: string;
  key: string;
  value: string;
}

/**
 * 解析通用 `prefs-add:` 链接。只做形状约束，不做业务语义判断 ——
 * 这个值该不该写、写进数组哪个位置，由技能配方与 LLM 负责，宿主一概不知。
 * 任何不合法（非本 scheme / 段数不对 / 域名或键名非法 / 值含危险字符 / 过长）
 * 一律返回 null，绝不把脏 href 回灌成用户消息。
 */
export function parsePrefAddHref(href: string | null | undefined): PrefAddTarget | null {
  if (typeof href !== 'string' || !href.startsWith(PREF_ADD_SCHEME)) return null;
  if (href.length > MAX_HREF_CHARS) return null;
  const rest = href.slice(PREF_ADD_SCHEME.length);
  // 前两个冒号分隔 domain / key，剩下整体作为 value（value 内禁止冒号，见上文）。
  const i1 = rest.indexOf(':');
  if (i1 < 0) return null;
  const i2 = rest.indexOf(':', i1 + 1);
  if (i2 < 0) return null;
  const domain = rest.slice(0, i1);
  const key = rest.slice(i1 + 1, i2);
  const value = rest.slice(i2 + 1);
  if (!KV_DOMAIN_NAME_RE.test(domain)) return null;
  if (!PREF_KEY_RE.test(key)) return null;
  if (!value || value.length > MAX_VALUE_CHARS) return null;
  if (PREF_VALUE_FORBIDDEN_RE.test(value)) return null;
  return { domain, key, value };
}

/**
 * 回灌给 LLM 的用户消息：只描述意图 + 带上域名 / 键名 / 刚点过的值，
 * 不复述业务数据、不替用户下写入以外的结论。让模型按配方去 kv_read / kv_write 并回执。
 */
export function prefAddUserMessage(t: PrefAddTarget): string {
  return `把「${t.value}」按当前技能说明保存到本地偏好（domain='${t.domain}'、key='${t.key}'），并回执结果。`;
}

/** 构造一条通用链接（给配方作者 / 测试用；模型侧按配方里的格式原样贴出即可） */
export function buildPrefAddHref(domain: string, key: string, value: string): string {
  return `${PREF_ADD_SCHEME}${domain}:${key}:${value}`;
}

// ---- 旧 scheme 兼容（保留既有导出名，历史链接与既有单测不受影响） ----

/** 校验旧链接里携带的股票代码。只做形状约束，不做行情语义判断。 */
export function parseWatchAddCode(href: string | null | undefined): string | null {
  if (typeof href !== 'string' || !href.startsWith(PREF_ADD_WATCH_SCHEME)) return null;
  const code = href.slice(PREF_ADD_WATCH_SCHEME.length);
  return STOCK_CODE_RE.test(code) ? code : null;
}

/** 旧回灌文案（股票专用，保持原样） */
export function watchAddUserMessage(code: string): string {
  return `把 ${code} 加入我的自选，请按技能说明保存到本地偏好并回执。`;
}
