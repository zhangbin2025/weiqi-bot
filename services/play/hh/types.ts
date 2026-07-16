/**
 * @fileoverview 真人对弈服务类型定义
 */

import type { BoardState, PlayerColor } from '../../../domain';

/** 玩家颜色 */
export type { PlayerColor };

/** 对弈配置 */
export interface IHHPlayConfig {
  /** 信令服务器 URL */
  signalingUrl: string;
  /** 每方用时（分钟） */
  timeLimit: number;
  /** 让子数 */
  handicap: number;
  /** 是否启用声效 */
  soundEnabled: boolean;
  /** 执棋颜色（创建房间时使用） */
  color?: PlayerColor;
}

/** 房间信息 */
export interface IRoomInfo {
  id: string;
  creatorName: string;
  creatorColor: PlayerColor;
  handicap: number;
  timeLimit: number;
  createdAt: number;
}

/** 玩家信息 */
export interface IPlayerInfo {
  name: string;
  color: PlayerColor;
  isCreator: boolean;
}

/** 信令消息类型 */
export type SignalingMessageType =
  | 'create' | 'join' | 'join-confirm' | 'room-info'
  | 'offer' | 'answer' | 'ice' | 'ping' | 'pong'
  | 'connected' | 'ready' | 'disconnected';

/** 信令消息 */
export interface ISignalingMessage {
  type: SignalingMessageType;
  [key: string]: unknown;
}

/** 游戏消息类型 */
export type GameMessageType =
  | 'move' | 'pass' | 'undo-request' | 'undo-response' | 'resign'
  | 'game-end' | 'state-sync' | 'time-sync' | 'heartbeat'
  | 'request-count' | 'count-response' | 'count-trigger' | 'count-result';

/** 落子消息 */
export interface IMoveMessage {
  type: 'move';
  x: number;
  y: number;
  color: PlayerColor;
  blackTime: number;
  whiteTime: number;
  /** 落子时间戳（毫秒） */
  timestamp?: number;
}

/** 虚手消息 */
export interface IPassMessage {
  type: 'pass';
  color: PlayerColor;
  blackTime: number;
  whiteTime: number;
}

/** 对局结束消息 */
export interface IGameEndMessage {
  type: 'game-end';
  winner: PlayerColor | 'draw';
  reason: 'resign' | 'timeout' | 'double_pass' | 'count';
  scoreLead?: number | undefined;
}

/** 数子请求消息 */
export interface IRequestCountMessage {
  type: 'request-count';
  from: string;
}

/** 数子回应消息 */
export interface ICountResponseMessage {
  type: 'count-response';
  agree: boolean;
}

/** 数子触发消息 */
export interface ICountTriggerMessage {
  type: 'count-trigger';
}

/** 数子结果消息 */
export interface ICountResultMessage {
  type: 'count-result';
  scoreLead: number;
}

/** P2P 消息类型 */
export type P2PMessage = 
  | IMoveMessage 
  | IPassMessage 
  | IGameEndMessage 
  | IRequestCountMessage
  | ICountResponseMessage
  | ICountTriggerMessage
  | ICountResultMessage
  | {
      type: GameMessageType;
      [key: string]: unknown;
    };
