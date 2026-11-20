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
 * 链接能原样落到 DOM（与 secret-prompt: 同款）。
 *
 * ## 2026-11-19 通用化：任何 skill 存用户数据都不再改宿主
 *
 * 早期曾为单一场景把 scheme 名、代码正则、回灌文案写死在宿主里，导致每加
 * 一类「加入自选」技能都要再注册 scheme、再改事件委托与白名单；现已统一。
 *
 * 现在统一为 `prefs-add:<domain>:<key>:<value>`：
 * - 宿主**不认识任何业务键名**（weather.watchlist / stock.watchlist 仍由配方声明），
 *   只做形状校验 + 回灌一条用户消息，读写仍由 LLM 按当前技能配方完成；
 * - domain / key 复用 KvDomains / KvService 的既有合法形状（口径有出处，不新造）；
 * - **模型侧写明文**（如 `[加入自选城市](prefs-add:prefs:weather.watchlist:北京)`），
 *   但 marked 渲染 markdown 链接时会自动把非 ASCII 做 percent 编码（实测 2026-11-19：
 *   北京 → %E5%8C%97%E4%BA%AC，而 ASCII 的 . - : 原样保留）。
 *   所以宿主解析时对 value 段做 decodeURIComponent，纯 ASCII 明文也照常可用；
 * - 新增技能要存偏好时，只需在配方里贴出这种链接并声明 domain/key，
 *   **不需要改宿主**。
 *
 * 2026-11-20：旧专用 scheme 的兼容路径已移除，宿主只认通用 scheme。
 */

import { KV_DOMAIN_NAME_RE } from '../../../../../application/skill/kv/KvDomains';

/** 通用自定义 scheme：点击 = 请 LLM 按技能说明把一条值存入本地偏好 */
export const PREF_ADD_SCHEME = 'prefs-add:';

/**
 * 键名形状：与 KvService 的 KV_KEY_RE 同源（字母数字 _ . -，长度上限沿用宿主
 * 单条键既有约束 128）。不是扫验证集挑出来的经验值，是复用既有事实。
 */
const PREF_KEY_RE = /^[A-Za-z0-9_.\-]{1,128}$/;

/**
 * value 段（**编码态**）允许的字符：URL 未保留字符 + `%`（percent 编码）。
 * 这是 marked 渲染后的 href 形态，不是用户看到的文本。分隔符 `:` 已在切分时
 * 消耗掉，所以值里仍不允许出现冒号。
 */
const PREF_VALUE_ENCODED_RE = /^[A-Za-z0-9\-_.!~*'()%]+$/;

/**
 * 解码后的值禁用的字符：全部来自 markdown `[](...)` / HTML 结构性语法与
 * 换行注入，不是拟合阈值。对**解码后**的字符串再校验一次，防止 `%3Cscript%3E`
 * 这类绕过。中文城市名、字母数字、逗号、横线、点都允许。
 */
const PREF_VALUE_FORBIDDEN_RE = /[:\s()\[\]<>"'#?]/;

/**
 * 单条 href 总长上限：**协议层护栏**，防超长脏串回灌进会话；不是从验证集挑的
 * 经验阈值，也不参与任何业务判定。真正的单条 prefs 值配额由 KvService 在写入时兜底。
 */
const MAX_HREF_CHARS = 2048;

/** 单个标识的长度上限（同上，协议护栏）：值是一个标识，不是整份列表 / JSON / 正文 */
const MAX_VALUE_CHARS = 256;

/** 通用 scheme 解析结果 */
export interface PrefAddTarget {
  domain: string;
  key: string;
  value: string;
}

/**
 * 解析通用 `prefs-add:` 链接。只做形状约束，不做业务语义判断 ——
 * 这个值该不该写、写进数组哪个位置，由技能配方与 LLM 负责，宿主一概不知。
 *
 * value 段可能是 marked 编码过的（中文 → %XX），也可能就是纯 ASCII 明文；
 * 先校验编码态形状，再 decodeURIComponent，最后对解码值再校验一次黑名单。
 * 任何不合法（非本 scheme / 段数不对 / 域名或键名非法 / 解码失败 / 危险字符 / 过长）
 * 一律返回 null，绝不把脏 href 回灌成用户消息。
 */
export function parsePrefAddHref(href: string | null | undefined): PrefAddTarget | null {
  if (typeof href !== 'string' || !href.startsWith(PREF_ADD_SCHEME)) return null;
  if (href.length > MAX_HREF_CHARS) return null;
  const rest = href.slice(PREF_ADD_SCHEME.length);
  // 前两个冒号分隔 domain / key，剩下整体作为 value（值内不允许冒号）。
  const i1 = rest.indexOf(':');
  if (i1 < 0) return null;
  const i2 = rest.indexOf(':', i1 + 1);
  if (i2 < 0) return null;
  const domain = rest.slice(0, i1);
  const key = rest.slice(i1 + 1, i2);
  const encoded = rest.slice(i2 + 1);
  if (!KV_DOMAIN_NAME_RE.test(domain)) return null;
  if (!PREF_KEY_RE.test(key)) return null;
  if (!encoded || encoded.length > MAX_VALUE_CHARS) return null;
  if (!PREF_VALUE_ENCODED_RE.test(encoded)) return null;
  let value: string;
  try {
    value = decodeURIComponent(encoded);
  } catch {
    return null; // 半截 % 或非法 UTF-8 序列
  }
  if (!value.trim() || value.length > MAX_VALUE_CHARS) return null;
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
