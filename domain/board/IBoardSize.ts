/**
 * 棋盘大小类型
 * 支持 9路、11路、13路、15路、17路、19路棋盘
 */
export type BoardSizeValue = 9 | 11 | 13 | 15 | 17 | 19;

/**
 * 棋盘大小接口
 * @ai-example
 * const size: IBoardSize = { size: 19 };
 */
export interface IBoardSize {
  /** 棋盘大小 */
  readonly size: BoardSizeValue;
}

/**
 * 获取星位坐标
 * @param boardSize - 棋盘大小
 * @returns 星位坐标列表
 * @ai-example
 * getStarPoints(19); // [{x:3,y:3},{x:3,y:9},{x:3,y:15},...]
 */
export function getStarPoints(boardSize: BoardSizeValue): { x: number; y: number }[] {
  const stars: { x: number; y: number }[] = [];
  switch (boardSize) {
    case 19: {
      // 9个星位：天元 + 8个角星
      const positions = [3, 9, 15];
      for (const y of positions) {
        for (const x of positions) {
          stars.push({ x, y });
        }
      }
      break;
    }
    case 13: {
      // 5个星位：天元 + 4个角星
      const positions = [3, 6, 9];
      for (const y of positions) {
        for (const x of positions) {
          stars.push({ x, y });
        }
      }
      break;
    }
    case 9: {
      // 5个星位：天元 + 4个角星
      stars.push({ x: 4, y: 4 }); // 天元
      stars.push({ x: 2, y: 2 });
      stars.push({ x: 6, y: 2 });
      stars.push({ x: 2, y: 6 });
      stars.push({ x: 6, y: 6 });
      break;
    }
    default:
      // 其他大小的星位（简化处理）
      const mid = Math.floor(boardSize / 2);
      const edge = boardSize >= 11 ? 3 : 2;
      stars.push({ x: mid, y: mid }); // 天元
      stars.push({ x: edge, y: edge });
      stars.push({ x: edge, y: boardSize - 1 - edge });
      stars.push({ x: boardSize - 1 - edge, y: edge });
      stars.push({ x: boardSize - 1 - edge, y: boardSize - 1 - edge });
  }
  return stars;
}

/**
 * 判断是否为星位
 * @param x - X 坐标
 * @param y - Y 坐标
 * @param boardSize - 棋盘大小
 * @returns 是否为星位
 * @ai-example
 * isStarPoint(3, 3, 19); // true
 * isStarPoint(0, 0, 19); // false
 */
export function isStarPoint(x: number, y: number, boardSize: BoardSizeValue): boolean {
  const stars = getStarPoints(boardSize);
  return stars.some((star) => star.x === x && star.y === y);
}

/**
 * 获取标准让子位置
 * @param handicap - 让子数 (1-9)
 * @param boardSize - 棋盘大小
 * @returns 让子位置列表
 * @ai-example
 * getHandicapPoints(2, 19); // [{x:3,y:15},{x:15,y:3}]
 */
export function getHandicapPoints(
  handicap: number,
  boardSize: BoardSizeValue
): { x: number; y: number }[] {
  if (handicap < 1 || handicap > 9 || boardSize !== 19) {
    return [];
  }
  // 标准 19 路棋盘让子位置
  const positions = [
    { x: 3, y: 15 }, // 右上（白棋视角）
    { x: 15, y: 3 }, // 左下
    { x: 15, y: 15 }, // 右下
    { x: 3, y: 3 }, // 左上
    { x: 9, y: 9 }, // 天元
    { x: 3, y: 9 }, // 左边
    { x: 15, y: 9 }, // 右边
    { x: 9, y: 3 }, // 上边
    { x: 9, y: 15 }, // 下边
  ];
  return positions.slice(0, handicap);
}