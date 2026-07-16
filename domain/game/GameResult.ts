/**
 * 对局结果格式化
 * @module domain/game/GameResult
 */

/**
 * 格式化围棋对局结果
 * @param result - SGF格式结果（如 "B+R", "W+2.5"）
 * @returns 中文显示结果
 * @ai-example
 * formatGameResult('B+R') → '黑中盘胜'
 * formatGameResult('W+2.5') → '白胜2.5目'
 */
export function formatGameResult(result?: string): string {
  if (!result) return '-';

  const specialResults: Record<string, string> = {
    'B+R': '黑中盘胜',
    'W+R': '白中盘胜',
    'B+T': '黑超时胜',
    'W+T': '白超时胜',
  };

  if (specialResults[result]) return specialResults[result];

  const match = result.match(/^([BW])\+([\d.]+)$/);
  if (match) {
    const winner = match[1] === 'B' ? '黑' : '白';
    return `${winner}胜${match[2]}目`;
  }

  return result;
}
