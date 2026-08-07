/**
 * 棋盘相关类型定义
 */
/** 坐标位置 */
export interface Position {
  x: number;
  y: number;
}
/** 棋盘大小类型 */
export type BoardSize = 9 | 13 | 19;
/** 棋盘主题 */
export type BoardTheme = 'classic' | 'wooden' | 'modern';
/** 高亮类型 */
export type HighlightType = 'last' | 'selected' | 'candidate' | 'correct' | 'answer' | 'wrong';
/** 棋子颜色（从 domain 层导入） */
export type PlayerColor = 'black' | 'white';
