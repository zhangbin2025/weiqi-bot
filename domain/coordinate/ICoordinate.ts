/**
 * 坐标接口
 * @ai-example
 * const coord: ICoordinate = { x: 3, y: 3 };
 */
export interface ICoordinate {
  /** X 坐标 (列, 0-18) */
  readonly x: number;
  /** Y 坐标 (行, 0-18) */
  readonly y: number;
}

/**
 * 创建坐标
 * @param x - X 坐标
 * @param y - Y 坐标
 * @returns 坐标对象
 * @ai-example
 * createCoordinate(3, 3); // { x: 3, y: 3 }
 */
export function createCoordinate(x: number, y: number): ICoordinate {
  return { x, y };
}

/**
 * 获取坐标的唯一键值
 * @param coord - 坐标
 * @returns 唯一键值 "x,y"
 * @ai-example
 * getCoordinateKey({ x: 3, y: 3 }); // "3,3"
 */
export function getCoordinateKey(coord: ICoordinate): string {
  return `${coord.x},${coord.y}`;
}

/**
 * 判断两个坐标是否相同
 * @param coord1 - 第一个坐标
 * @param coord2 - 第二个坐标
 * @returns 是否相同
 * @ai-example
 * isSameCoordinate({ x: 3, y: 3 }, { x: 3, y: 3 }); // true
 */
export function isSameCoordinate(coord1: ICoordinate, coord2: ICoordinate): boolean {
  return coord1.x === coord2.x && coord1.y === coord2.y;
}

/**
 * 计算两坐标间的距离（棋盘距离）
 * @param coord1 - 第一个坐标
 * @param coord2 - 第二个坐标
 * @returns 棋盘距离 (曼哈顿距离)
 * @ai-example
 * getManhattanDistance({ x: 3, y: 3 }, { x: 5, y: 5 }); // 4
 */
export function getManhattanDistance(coord1: ICoordinate, coord2: ICoordinate): number {
  return Math.abs(coord1.x - coord2.x) + Math.abs(coord1.y - coord2.y);
}

/**
 * 获取相邻坐标（上下左右四个方向）
 * @param coord - 坐标
 * @param boardSize - 棋盘大小
 * @returns 相邻坐标列表
 * @ai-example
 * getAdjacentCoordinates({ x: 3, y: 3 }, 19); // [{x:2,y:3},{x:4,y:3},{x:3,y:2},{x:3,y:4}]
 */
export function getAdjacentCoordinates(
  coord: ICoordinate,
  boardSize: number
): ICoordinate[] {
  const directions = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ];
  const result: ICoordinate[] = [];
  for (const { dx, dy } of directions) {
    const newX = coord.x + dx;
    const newY = coord.y + dy;
    if (newX >= 0 && newX < boardSize && newY >= 0 && newY < boardSize) {
      result.push(createCoordinate(newX, newY));
    }
  }
  return result;
}