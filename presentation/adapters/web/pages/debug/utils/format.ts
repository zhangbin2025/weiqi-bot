/**
 * 格式化工具函数
 * @module presentation/adapters/web/pages/debug/utils/format
 */
/**
 * 格式化时间
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}
/**
 * 格式化大小
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
/**
 * 获取日志级别颜色
 */
export function getLevelColor(level: string): string {
  switch (level) {
    case 'ERROR': return '#f44';
    case 'WARN': return '#f80';
    case 'INFO': return '#08f';
    case 'DEBUG': return '#888';
    default: return '#fff';
  }
}
/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
