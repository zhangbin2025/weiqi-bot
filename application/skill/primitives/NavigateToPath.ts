/**
 * navigate_to 的站内链接构造与观察文本（纯函数，便于单测）
 * @module application/skill/primitives/NavigateToPath
 *
 * 边界：
 * - 模型只给「路径 + 语义化查询参数」，URL 编码一律由宿主完成；
 * - **模型永远不接触 URL**：真实带参路径经 ToolOutcome.actionLink 由宿主
 *   直接渲染成 <a> 并落历史；工具观察里不含链接，模型回复里也不写链接。
 *   这是根治「同一会话第二轮照抄历史旧链接」的关键（2026-11-16 用户实测）。
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
 * 工具返回给模型的观察文本：宿主已经把链接放好，模型只写引导语。
 *
 * @description 这是 2026-11-16 多轮 bug 的根治点。旧设计让模型「原样复述」
 *              观察里的链接，而 ChatUseCase 落历史的是 safeReply 之后的渲染态
 *              文本、ToolLoop 的观察不落历史 —— 下一轮模型只能从历史里翻出旧
 *              链接照抄，换题型/难度时必然错。现在真实路径走 ToolOutcome.
 *              actionLink 由宿主直接渲染并落历史，observation 里不含任何链接，
 *              模型回复里也不该出现链接。
 */
/** _path 保留在签名里只为兼容调用点；真实链接走 actionLink，不进这段文本 */
export function navigateToObservation(label: string, _path: string): string {
  const safeLabel = label.replace(/[\[\]\r\n]/g, '').trim() || '打开页面';
  return [
    `已为你生成「${safeLabel}」的做题页链接，宿主会直接把它显示在这条回复下方。`,
    '本轮回复只写一句简短引导语（比如点出这类题的要点），然后停笔：',
    '不要写任何链接、网址、markdown 链接、括号里的地址，也不要复述这段说明；',
    '不要编造具体题目或答案。',
  ].join('\n');
}
