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
      {
      {
      // 其他大小的星位（简化处理）
      const mid = Math.floor(boardSize / 2);
      const edge = boardSize >= 11 ? 3 : 2;
      stars.push({ x: mid, y: mid }); // 天元
      stars.push({ x: edge, y: edge });
      stars.push({ x: edge, y: boardSize - 1 - edge });
      stars.push({ x: boardSize - 1 - edge, y: edge });
      stars.push({ x: boardSize - 1 - edge, y: boardSize - 1 - edge });
      }
      }
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
  if (handicap < 1 || handicap > 9) {
    return [];
  }

  // 各棋盘大小的标准让子位置（按让子数 2-9 递增）
  // 位置顺序遵循围棋惯例：对角星 → 天元 → 边星
  const handicapTable: Record<number, Array<{ x: number; y: number }>> = {
    19: [
      { x: 3, y: 15 },   // 2子: 对角星
      { x: 15, y: 3 },   // 3子: 对角星
      { x: 15, y: 15 },  // 4子: 对角星
      { x: 3, y: 3 },    // (4子齐全)
      { x: 9, y: 9 },    // 5子: 天元
      { x: 3, y: 9 },    // 6子: 左边
      { x: 15, y: 9 },   // 7子: 右边
      { x: 9, y: 3 },    // 8子: 上边
      { x: 9, y: 15 },   // 9子: 下边
    ],
    13: [
      { x: 9, y: 3 },    // 2子: 对角星
      { x: 3, y: 9 },    // 3子: 对角星
      { x: 3, y: 3 },    // 4子: 对角星
      { x: 9, y: 9 },    // (4子齐全)
      { x: 6, y: 6 },    // 5子: 天元
      { x: 3, y: 6 },    // 6子: 左边
      { x: 9, y: 6 },    // 7子: 右边
      { x: 6, y: 3 },    // 8子: 上边
      { x: 6, y: 9 },    // 9子: 下边
    ],
    9: [
      { x: 6, y: 2 },    // 2子: 对角星
      { x: 2, y: 6 },    // 3子: 对角星
      { x: 2, y: 2 },    // 4子: 对角星
      { x: 6, y: 6 },    // (4子齐全)
      { x: 4, y: 4 },    // 5子: 天元 (9路天元为(4,4))
      { x: 2, y: 4 },    // 6子: 左边
      { x: 6, y: 4 },    // 7子: 右边
      { x: 4, y: 2 },    // 8子: 上边
      { x: 4, y: 6 },    // 9子: 下边
    ],
  };

  const positions = handicapTable[boardSize];
  if (!positions) {
    // 11/15/17 路等非常见棋盘大小，按通用公式计算
    const edge = boardSize >= 11 ? 3 : 2;
    const mid = Math.floor(boardSize / 2);
    const fallback: Array<{ x: number; y: number }> = [
      { x: edge, y: boardSize - 1 - edge },
      { x: boardSize - 1 - edge, y: edge },
      { x: boardSize - 1 - edge, y: boardSize - 1 - edge },
      { x: edge, y: edge },
      { x: mid, y: mid },
      { x: edge, y: mid },
      { x: boardSize - 1 - edge, y: mid },
      { x: mid, y: edge },
      { x: mid, y: boardSize - 1 - edge },
    ];
    return fallback.slice(0, handicap);
  }

  // handicap=1 时不返回位置（1子让子棋即黑棋先走，无需放子）
  if (handicap === 1) return [];
  return positions.slice(0, handicap);
}