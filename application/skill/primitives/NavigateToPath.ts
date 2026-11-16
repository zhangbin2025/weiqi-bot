/**
 * navigate_to 的站内链接构造与短链注册（纯函数 + 进程内表，便于单测）
 * @module application/skill/primitives/NavigateToPath
 *
 * 边界：
 * - 模型只给「路径 + 语义化查询参数」，URL 编码一律由宿主完成；
 * - **模型永远看不到含 & 的 URL**：safeReply 会把整条回复里的 & 转成 &amp;，
 *   让模型复述 [label](/puzzle?type=x&difficulty=y) 会污染 href（实测
 *   URLSearchParams 解出键 amp;difficulty）。故宿主把真实路径存内存，
 *   只回一条 nav:<token> 短链；渲染层用 DOM 属性赋值还原 href。
 *   与 event-table:<token> 同一套路（上午已验证）。
 */

/** 只放行以 '/' 开头、不含 '://'、不含 '..' 的站内绝对路径 */
export function isValidNavigateToPath(path: string): boolean {
  return path.startsWith('/') && !path.includes('://') && !path.includes('..');
}

/** 查询参数清洗：只保留非空字符串键与值（模型偶尔会塞 null/数字/嵌套对象） */
export function sanitizeNavigateToQuery(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    out[key.trim()] = value.trim();
  }
  return out;
}

/**
 * 把站内路径与查询参数拼成最终路径。
 * @description URLSearchParams 负责百分号编码（中文题型「手筋」→ %E6%89%8B%E7%AD%8B）；
 *              路径已带 ? 时用 & 追加。无有效参数时原样返回 path。
 */
export function buildNavigateToPath(path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  if (!qs) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

// ==================== 短链注册表 ====================
/** 自定义 scheme 前缀：与 event-table: / schedule-run: 同一套路 */
export const NAVIGATE_LINK_SCHEME = 'nav:';

/**
 * token → 真实站内路径。只存在当前页面生命周期内（刷新即失效，短链本来就是
 * 「这轮对话点一下」的性质），不写 localStorage、不进会话历史。
 * 上限 200 条，超出淘汰最早一条 —— 单页会话不会无限堆积，纯展示态无需持久化。
 */
const NAVIGATE_LINK_STORE = new Map<string, string>();
const NAVIGATE_LINK_MAX = 200;
let navigateLinkSeq = 0;

/** 登记一条路径，返回不含 & / % / 中文的短 token（供 observation 使用） */
export function registerNavigateToPath(path: string): string {
  navigateLinkSeq += 1;
  const token = `n${navigateLinkSeq}-${Math.random().toString(36).slice(2, 10)}`;
  NAVIGATE_LINK_STORE.set(token, path);
  if (NAVIGATE_LINK_STORE.size > NAVIGATE_LINK_MAX) {
    const oldest = NAVIGATE_LINK_STORE.keys().next().value;
    if (oldest !== undefined) NAVIGATE_LINK_STORE.delete(oldest);
  }
  return token;
}

/** 渲染层用：取出短链对应的真实路径；未知/失效返回 null */
export function resolveNavigateToPath(token: string): string | null {
  return NAVIGATE_LINK_STORE.get(token) ?? null;
}

/**
 * 工具返回给模型的观察文本：一条 **不含 & 的短链** + 给模型的贴链约束。
 * @description observation 是 role:'tool' 消息，模型据此写最终回复；
 *              safeReply 会无条件转义整条回复，所以这里绝不能出现带 & 的真实 URL。
 *              短链形如 [做8K手筋题](nav:n7-x3kf9a)，渲染层再还原成真路径。
 */
export function navigateToObservation(label: string, token: string): string {
  const safeLabel = label.replace(/[\[\]\r\n]/g, '').trim() || '打开页面';
  return [
    '本轮回复只做一件事：把下面这一行链接**原样**贴给用户',
    '（不要改写、不要念出括号里的地址、不要加代码块、不要加引号），贴完就停笔：',
    '',
    `[${safeLabel}](${NAVIGATE_LINK_SCHEME}${token})`,
  ].join('\n');
}
