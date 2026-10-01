/**
 * @fileoverview 野狐围棋解析工具
 * 结局解析已统一到 domain/game/GameResult.ts
 */

import { parseResultFromWinnerReason, formatGameResult } from "../../../../domain/game/GameResult";

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
 * 解析对局结果（中文显示）
 * @param winner - 胜者：0=和棋，1=黑胜，2=白胜
 * @param point - 胜子数
 * @param reason - 结果类型：1=数子，2=超时，3=中盘，4=认输
 * @returns 中文格式化结果字符串
 * @ai-example
 * parseResult(1, 5, 1); // "黑胜5目"
 * parseResult(2, 0, 3); // "白中盘胜"
 */
export function parseResult(
  winner: number,
  point: number,
  reason: number
): string {
  const sgfResult = parseResultFromWinnerReason(winner, point, reason);
  if (!sgfResult) return "";
  return formatGameResult(sgfResult);
}
