/**
 * navigate_to 的站内链接构造（纯函数，无副作用，便于单测）
 * @module application/skill/primitives/NavigateToPath
 *
 * 边界：模型只给「路径 + 语义化查询参数」，URL 编码一律由宿主完成。
 * 配方里因此不必出现 %XX、and/or 表达式等易错语法，也不让模型输出裸 URL。
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

/**
 * 工具返回给模型的观察文本：一条可点的 markdown 短链接 + 给模型的贴链约束。
 * @description observation 是 role:'tool' 消息，模型会据此写最终回复；safeReply 会转义
 *              后由 marked 渲染，站内绝对路径裸文本不会被 autolink，故必须给 markdown 链接。
 *              标签只取调用方传入的短文字并去掉 [ ] 防注入，路径由宿主编码不含裸引号。
 */
export function navigateToObservation(label: string, path: string): string {
  const safeLabel = label.replace(/[\[\]\r\n]/g, '').trim() || '打开页面';
  return `请直接把下面这条链接原样抄进回复（不要改写、不要念出 URL、不要加代码块），再停笔：[${safeLabel}](${path})`;
}
