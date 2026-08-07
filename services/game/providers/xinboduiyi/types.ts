/**
 * @fileoverview 新博对弈类型定义
 */

/**
 * 新博对弈元数据
 */
export interface XinboduiyiMetadata {
  /** 对局 ID */
  gameId: string;
  /** 黑方名称 */
  blackName: string;
  /** 白方名称 */
  whiteName: string;
  /** 对局结果 */
  result: string;
  /** 对局日期 */
  date: string;
  /** 对局名称 */
  gameName: string;
  /** 贴目 */
  komi: number;
  /** 棋盘大小 */
  boardSize: number;
  /** 着法数 */
  movesCount: number;
}

/**
 * 新博对弈游戏数据响应
 */
export interface XinboduiyiGameData {
  /** 对局 Key */
  GameKey?: string;
  /** 黑方别名 */
  BlackAliasName?: string;
  /** 白方别名 */
  WhiteAliasName?: string;
  /** 结果码 */
  ResultCode?: number;
  /** 结果类型 */
  resultType?: number;
  /** 棋盘大小 */
  BoardSize?: number;
  /** 贴目值 */
  komi_value?: number;
  /** 着法字符串 */
  StepStr?: string;
  /** 分谱数据 */
  part_qipu?: Array<{
    part_id: number;
    latest_full_qipu?: string;
  }>;
}