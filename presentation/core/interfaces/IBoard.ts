/**
 * 棋盘接口定义
 * 平台无关的棋盘 UI 接口
 */
import type { Position, BoardSize, BoardTheme, HighlightType, PlayerColor, IBoardEvents } from '../types';
/** 棋盘配置 */
export interface IBoardConfig {
  /** 棋盘大小 */
  size?: BoardSize;
  /** 是否显示坐标 */
  showCoordinates?: boolean;
  /** 是否显示手数 */
  showMoveNumbers?: boolean;
  /** 棋盘主题 */
  theme?: BoardTheme;
}
/** 棋盘接口 */
export interface IBoard {
  /** 棋盘大小 */
  readonly size: BoardSize;
  /** 初始化棋盘 */
  initialize(config?: IBoardConfig): void;
  /** 渲染棋盘 */
  render(): void;
  /** 清空棋盘 */
  clear(): void;
  /** 放置棋子 */
  placeStone(pos: Position, color: PlayerColor): void;
  /** 移除棋子 */
  removeStone(pos: Position): void;
  /** 批量设置棋盘状态 */
  setStones(stones: Array<{ pos: Position; color: PlayerColor | null }>): void;
  /** 获取棋盘状态 */
  getStones(): Map<string, PlayerColor>;
  /** 高亮位置 */
  highlight(pos: Position, type: HighlightType): void;
  /** 清除高亮 */
  clearHighlight(): void;
  /** 显示标记（A, B, C...） */
  setMarker(pos: Position, marker: string): void;
  /** 设置某位置的手数 */
  setMoveNumber(pos: Position, number: number): void;
  /** 清除所有手数显示 */
  clearMoveNumbers(): void;
  /** 批量设置手数 */
  setMoveNumbers(moves: Array<{ pos: Position; number: number }>): void;
  /** 注册事件 */
  on(events: IBoardEvents): void;
  /** 销毁 */
  destroy(): void;
}
