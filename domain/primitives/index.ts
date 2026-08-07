// 基础类型导出
export type { IPlayer, PlayerColor, SGFColor } from './IPlayer';
export type { IStone } from './IStone';
export {
  getOpponentColor,
  sgfColorToPlayerColor,
  playerColorToSGFColor,
} from './IPlayer';
export { createStone, isSamePosition, isSameStone, getStoneKey } from './IStone';
