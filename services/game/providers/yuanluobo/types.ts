/**
 * @fileoverview 元萝卜类型定义
 */

/**
 * 元萝卜 API 响应
 */
export interface YuanluoboApiResponse {
  code: number;
  message?: string;
  data: YuanluoboGameData;
}

/**
 * 元萝卜游戏数据
 */
export interface YuanluoboGameData {
  session_id?: string;
  black_player_name?: string;
  white_player_name?: string;
  handicap?: number;
  total_round?: number;
  recording?: {
    moves: Array<{ coordinate: string }>;
  };
}

/**
 * 元萝卜元数据
 */
export interface YuanluoboMetadata {
  /** 会话 ID */
  sessionId: string;
  /** 黑方名称 */
  blackName: string;
  /** 白方名称 */
  whiteName: string;
  /** 让子数 */
  handicap: number;
  /** 总回合数 */
  totalRound: number;
}