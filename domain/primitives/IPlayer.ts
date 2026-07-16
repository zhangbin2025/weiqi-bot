/**
 * 棋手颜色接口
 * @ai-example
 * const black: IPlayer = { color: 'black' };
 * const white: IPlayer = { color: 'white' };
 */
export interface IPlayer {
  /** 棋手颜色 */
  readonly color: PlayerColor;
}

/**
 * 棋手颜色类型
 * - 'black' - 黑方
 * - 'white' - 白方
 */
export type PlayerColor = 'black' | 'white';

/**
 * SGF 颜色表示
 * - 'B' - 黑方
 * - 'W' - 白方
 */
export type SGFColor = 'B' | 'W';

/**
 * 获取对方颜色
 * @param color - 当前颜色
 * @returns 对方颜色
 * @ai-example
 * getOpponentColor('black'); // 'white'
 * getOpponentColor('white'); // 'black'
 */
export function getOpponentColor(color: PlayerColor): PlayerColor {
  return color === 'black' ? 'white' : 'black';
}

/**
 * SGF 颜色转棋手颜色
 * @param sgfColor - SGF 颜色字符
 * @returns 棋手颜色
 * @ai-example
 * sgfColorToPlayerColor('B'); // 'black'
 * sgfColorToPlayerColor('W'); // 'white'
 */
export function sgfColorToPlayerColor(sgfColor: SGFColor): PlayerColor {
  return sgfColor === 'B' ? 'black' : 'white';
}

/**
 * 棋手颜色转 SGF 颜色
 * @param playerColor - 棋手颜色
 * @returns SGF 颜色字符
 * @ai-example
 * playerColorToSGFColor('black'); // 'B'
 * playerColorToSGFColor('white'); // 'W'
 */
export function playerColorToSGFColor(playerColor: PlayerColor): SGFColor {
  return playerColor === 'black' ? 'B' : 'W';
}
