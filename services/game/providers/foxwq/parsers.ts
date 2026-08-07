/**
 * @fileoverview 野狐围棋解析工具
 */

/**
 * 格式化段位显示
 * @param danValue - 段位原始值
 * @returns 格式化后的段位字符串
 * @ai-example
 * formatDan(105); // "职业5段"
 * formatDan(25);  // "业5段"
 * formatDan(15);  // "5级"
 */
export function formatDan(danValue: number): string {
  if (danValue >= 100) {
    return `职业${danValue - 100}段`;
  } else if (danValue >= 20) {
    return `业${danValue - 20}段`;
  } else if (danValue >= 10) {
    return `${danValue - 10}级`;
  } else {
    return `${danValue}级`;
  }
}

/**
 * 解析对局结果
 * @param winner - 胜者：0=和棋，1=黑胜，2=白胜
 * @param point - 胜子数
 * @param reason - 结果类型：1=数子，2=超时，3=中盘，4=认输
 * @returns 格式化后的结果字符串
 * @ai-example
 * parseResult(1, 5, 1); // "黑胜 5子"
 * parseResult(2, 0, 3); // "白胜 (中盘)"
 */
export function parseResult(
  winner: number,
  point: number,
  reason: number
): string {
  if (winner === 0) {
    return '和棋';
  }

  const winnerStr = winner === 1 ? '黑胜' : '白胜';

  switch (reason) {
    case 1:
      return point > 0 ? `${winnerStr} ${point}子` : winnerStr;
    case 2:
      return `${winnerStr} (超时)`;
    case 3:
      return `${winnerStr} (中盘)`;
    case 4:
      return `${winnerStr} (认输)`;
    default:
      return winnerStr;
  }
}
