/**
 * 「使用偏好」场景的链接契约（单一出处）
 * @module presentation/adapters/web/pages/assistant/PrefLink
 *
 * 本地数据层两期场景刻意做成镜像：
 * - 第一期（凭据）：`secrets` 域 opaque / host 写。secret-prompt:<key> 链接由宿主
 *   接管，弹框直接 `kv.put('secrets', ...)`，明文永不过模型。
 * - 第二期（使用偏好）：`prefs` 域 readable / model 写。链接只回灌一条**用户消息**，
 *   宿主不碰存储；由 LLM 按技能配方指令自己调 kv_read / kv_write。宿主不替模型
 *   做决定，链接里也不携带待写入的值（值由 LLM 从刚刚那轮报价的上下文里取）。
 *
 * 为什么走 markdown 链接 + document 事件委托，而不是 ToolOutcome.actionLink：
 * AssistantRenderer.resolvePath 会把自定义 scheme 改写成站内路径，只有 markdown
 * 链接能原样落到 DOM（与 event-table: / secret-prompt: 同款）。
 *
 * 链接里只放「动作 + 一个股票代码」这类用户已表达过的意图标识，不放 JSON 值、
 * 不放任意 URL、不放待写内容。代码形状由宿主严格校验，挡住模型编造 / 注入。
 * 这里**不注册新原语**：kv_* 已是 chat 角色恒定挂载的通用能力，配方直接引用即可。
 */

/** 自定义 scheme：点击 = 请 LLM 把这只股票加进自选（不是宿主直接写库） */
export const PREF_ADD_WATCH_SCHEME = 'stock-watch-add:';

/**
 * 股票代码形状：与配方里的代码转换口径同源 ——
 * 沪深(sh/sz) 是 6 位数字、港股(hk) 是 5 位数字、美股(us) 是字母数字点。
 * 这不是扫验证集挑出来的阈值：它来自各市场代码位数的既有事实。
 */
const STOCK_CODE_RE = /^(?:sh\d{6}|sz\d{6}|hk\d{5}|us[A-Za-z0-9.]{1,10})$/;

/**
 * 校验链接里携带的股票代码。只做形状约束，不做行情语义判断 ——
 * 代码是不是真实存在由报价接口与 LLM 负责，宿主只挡注入。
 */
export function parseWatchAddCode(href: string | null | undefined): string | null {
  if (typeof href !== 'string' || !href.startsWith(PREF_ADD_WATCH_SCHEME)) return null;
  const code = href.slice(PREF_ADD_WATCH_SCHEME.length);
  return STOCK_CODE_RE.test(code) ? code : null;
}

/**
 * 回灌给 LLM 的用户消息：只描述意图 + 带上刚点过的代码，不复述价格、
 * 不替用户下任何写入指令以外的结论。让模型按配方去读 / 写 prefs 并回执。
 */
export function watchAddUserMessage(code: string): string {
  return `把 ${code} 加入我的自选，请按技能说明保存到本地偏好并回执。`;
}
