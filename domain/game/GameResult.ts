/**
 * 对局结果格式化与解析
 * @module domain/game/GameResult
 * @description 统一管理所有平台的对局结果解析，各 provider 必须使用本模块函数
 */

// ==================== 格式化（SGF RE[] -> 中文显示） ====================

/**
 * 格式化围棋对局结果
 * @param result - SGF格式结果（如 "B+R", "W+2.5"）
 * @returns 中文显示结果
 * @ai-example
 * formatGameResult("B+R") → "黑中盘胜"
 * formatGameResult("W+2.5") → "白胜2.5目"
 */
export function formatGameResult(result?: string): string {
  if (!result) return "-";

  const specialResults: Record<string, string> = {
    "B+R": "黑中盘胜",
    "W+R": "白中盘胜",
    "B+T": "黑超时胜",
    "W+T": "白超时胜",
    "0": "和棋",
    Draw: "和棋",
  };

  if (specialResults[result]) return specialResults[result];

  const match = result.match(/^([BW])\+([\d.]+)$/);
  if (match) {
    const winner = match[1] === "B" ? "黑" : "白";
    return `${winner}胜${match[2]}目`;
  }

  return result;
}

// ==================== 平台原始数据 -> SGF RE[] 标准格式 ====================

/**
 * 结局原因类型（各平台通用）
 * - 1=数子, 2=超时, 3=中盘, 4=认输
 */
export type ResultReason = 1 | 2 | 3 | 4;

/**
 * 从胜负方+子数+原因解析为 SGF RE[] 格式
 * 适用于野狐 Protobuf 等平台的结构化结局数据
 *
 * @param winner - 胜者：0=和棋, 1=黑胜, 2=白胜
 * @param points - 胜子/目数（数子结果时使用）
 * @param reason - 结果类型：1=数子, 2=超时, 3=中盘, 4=认输
 * @returns SGF RE[] 格式字符串（如 "B+R", "W+2.5", "0"），或 null 表示无有效结果
 *
 * @ai-example
 * parseResultFromWinnerReason(1, 5, 1)  → "B+5"
 * parseResultFromWinnerReason(2, 0, 3)  → "W+R"
 * parseResultFromWinnerReason(0, 0, 1)  → "0"
 */
export function parseResultFromWinnerReason(
  winner: number,
  points: number,
  reason: number,
): string | null {
  if (winner === 0) return "0";
  if (winner !== 1 && winner !== 2) return null;

  const winnerStr = winner === 1 ? "B" : "W";

  switch (reason) {
    case 1: // 数子
      if (points > 0) return `${winnerStr}+${points}`;
      if (points === 0) return "0"; // 和棋
      return `${winnerStr}+${Math.abs(points)}`;
    case 2: // 超时
      return `${winnerStr}+T`;
    case 3: // 中盘
      return `${winnerStr}+R`;
    case 4: // 认输
      return `${winnerStr}+R`;
    default:
      return `${winnerStr}+`;
  }
}

/**
 * 从新博对弈的结果码解析为 SGF RE[] 格式
 *
 * @param resultCode - 胜者码：0=无结果/和棋, 1=黑胜, 2=白胜
 * @param resultType - 结果类型：1=中盘, 2=数子, 3=超时, 4=认输
 * @returns SGF RE[] 格式字符串，或空字符串表示无结果
 *
 * @ai-example
 * parseResultFromCode(1, 1)  → "B+R"
 * parseResultFromCode(2, 2)  → "W+"
 * parseResultFromCode(0, 0)  → ""
 */
export function parseResultFromCode(
  resultCode?: number,
  resultType?: number,
): string {
  if (resultCode === 0 || resultCode === undefined) return "";

  const winner = resultCode === 1 ? "B" : "W";
  const typeMap: Record<number, string> = {
    1: "+R", // 中盘
    2: "+", // 数子(子数未知时只标胜方)
    3: "+T", // 超时
    4: "+R", // 认输
  };

  return `${winner}${typeMap[resultType || 1]}`;
}

/**
 * 从中文结果字符串解析为 SGF RE[] 格式
 * 适用于 izis 等平台返回中文结局描述的情况
 *
 * @param resultStr - 中文结果字符串（如 "白胜", "黑中盘胜", "和棋"）
 * @returns SGF RE[] 格式字符串，无法识别时原样返回
 *
 * @ai-example
 * parseResultFromText("白胜")    → "W+R"
 * parseResultFromText("黑中盘胜") → "B+R"
 * parseResultFromText("和棋")    → "Draw"
 * parseResultFromText("")       → ""
 */
export function parseResultFromText(resultStr: string): string {
  if (!resultStr) return "";

  const map: Record<string, string> = {
    白胜: "W+R",
    黑胜: "B+R",
    白中盘胜: "W+R",
    黑中盘胜: "B+R",
    和棋: "Draw",
  };
  return map[resultStr] || resultStr;
}
