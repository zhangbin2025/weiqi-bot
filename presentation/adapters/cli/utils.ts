/**
 * 终端格式化工具函数
 * @module presentation/adapters/cli/utils
 */
/** 清理棋手名（去掉ID后缀） */
export function cleanName(name: string): string {
  if (!name) return '';
  const chineseMatch = name.match(/[\u4e00-\u9fa5]{2,4}/);
  if (chineseMatch) return chineseMatch[0];
  return name
    .replace(/\|[\d\w:_-]+$/, '')
    .replace(/\[[\d\w:_-]+\]$/, '')
    .replace(/\([\d\w:_-]+\)$/, '')
    .replace(/_[\d\w:_-]+$/, '')
    .trim();
}
