/**
 * 题目列表工具函数
 * @description 提供 HTML 转义、文本格式化等工具函数
 */

/**
 * HTML 转义
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 属性转义
 */
export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

/**
 * 获取来源文本
 */
export function getSourceText(source: string): string {
  return source === 'foxwq' ? '野狐' : source;
}

/**
 * 获取等级文本
 */
export function getLevelText(level: string): string {
  const levelMap: Record<string, string> = {
    pro: '职业',
    high: '高段',
    normal: '普通',
  };
  return levelMap[level] || '普通';
}

/**
 * 格式化比赛结果
 */
export function formatResult(result: string): string {
  if (!result) return '';
  return result
    .replace(/^B\+R$/i, '黑中盘胜')
    .replace(/^W\+R$/i, '白中盘胜')
    .replace(/^B\+([\d.]+)$/i, '黑胜$1目')
    .replace(/^W\+([\d.]+)$/i, '白胜$1目');
}

/**
 * 显示错误信息
 */
export function showError(message: string): void {
  const listContainer = document.getElementById('problem-list');
  const subtitle = document.getElementById('subtitle');
  
  if (subtitle) {
    subtitle.textContent = '加载失败';
  }
  
  if (listContainer) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
  }
}
