/**
 * @fileoverview 真人对弈服务接口
 */

import type {
  IHHPlayConfig,
  IRoomInfo,
  IPlayerInfo,
  PlayerColor,
} from './types';
import type { HHPlayDraft } from './DraftTypes';
import type { BoardState } from '../../../domain';

/** 对弈状态 */
export interface IHHPlayState {
  room: IRoomInfo | null;
  me: IPlayerInfo | null;
  opponent: IPlayerInfo | null;
  board: BoardState;
  currentPlayer: PlayerColor;
  moveHistory: Array<{ x: number; y: number; color: PlayerColor }>;
  blackTime: number;
  whiteTime: number;
  gameEnded: boolean;
  inGame: boolean;
}

/** 对弈回调 */
export interface IHHPlayCallbacks {
  onRoomCreated?: (room: IRoomInfo) => void;
  onPlayerJoined?: (player: IPlayerInfo) => void;
  onMove?: (x: number, y: number, color: PlayerColor) => void;
  onPass?: (color: PlayerColor) => void;
  /** 提子时触发 */
  onCapture?: (count: number, color: PlayerColor) => void;
  onTimeUpdate?: (blackTime: number, whiteTime: number) => void;
  onGameEnd?: (winner: PlayerColor | 'draw', reason: string, scoreLead?: number) => void;
  onOpponentDisconnected?: () => void;
  onOpponentReconnected?: () => void; // 对手重连成功
  onReconnectAttempt?: (countdown: number) => void;
  onError?: (error: Error) => void;
  /** 收到房间信息（首次加入时需要确认） */
  onRoomInfo?: (info: { name: string; color: PlayerColor; handicap: number; timeLimit: number }) => void;
  /** 收到悔棋请求 */
  onUndoRequest?: (from: string) => void;
  /** 悔棋被拒绝 */
  onUndoRejected?: () => void;
  /** 收到数子请求 */
  onCountRequest?: (from: string) => void;
  /** 收到数子回应 */
  onCountResponse?: (agree: boolean) => void;
  /** 数子结果 */
  onCountResult?: (scoreLead: number, winner: PlayerColor | 'draw') => void;
  /** 收到心跳（兜底检查，纠正状态） */
  onHeartbeatReceived?: () => void;
}

/**
 * 真人对弈服务接口
 * @ai-example
 * const service: IHHPlayService = new HHPlayService();
 * const room = await service.createRoom('玩家A', { timeLimit: 30 });
 * await service.joinRoom(room.id, '玩家B');
 * await service.move(3, 3);
 */
export interface IHHPlayService {
  /** 创建房间 */
  createRoom(name: string, config: Partial<IHHPlayConfig>): Promise<IRoomInfo>;
  /** 加入房间 */
  joinRoom(roomId: string, name: string): Promise<IPlayerInfo>;
  /** 确认加入房间 */
  confirmJoin(name: string): Promise<IPlayerInfo>;
  /** 获取房间信息（加入前） */
  getRoomInfo(): {
    creatorName: string;
    creatorColor: PlayerColor;
    handicap: number;
    timeLimit: number;
  } | null;
  /** 落子 */
  move(x: number, y: number): Promise<void>;
  /** 检查是否可以落子（不改变状态） */
  canMove(x: number, y: number): boolean;
  /** 虚手 */
  pass(): Promise<void>;
  /** 悔棋请求 */
  requestUndo(): Promise<void>;
  /** 同意/拒绝悔棋 */
  respondUndo(accept: boolean): Promise<void>;
  /** 认输 */
  resign(): Promise<void>;
  /** 断线重连 */
  reconnect(): Promise<void>;
  /** 离开房间 */
  leaveRoom(): Promise<void>;
  /** 获取当前状态 */
  getState(): IHHPlayState;
  /** 设置回调 */
  setCallbacks(callbacks: IHHPlayCallbacks): void;
  /** 获取着法历史 */
  getMoveHistory(): Array<{ x: number; y: number; color: PlayerColor }>;
  /** 生成 SGF 字符串 */
  exportSgf(metadata?: { blackName?: string; whiteName?: string; result?: string }): string;
  /** 数子计算胜负 */
  countTerritory(komi: number): Promise<{
    blackTerritory: number;
    whiteTerritory: number;
    scoreLead: number;
    winner: 'black' | 'white' | 'draw';
  }>;
  /** 申请数子 */
  requestCount(): Promise<void>;
  /** 回应数子请求 */
  respondCount(agree: boolean): Promise<void>;
  /** 执行数子 */
  doCount(): Promise<void>;
  
  // ===== 草稿管理 =====
  
  /** 从草稿恢复对局 */
  restoreFromDraft(draft: HHPlayDraft): Promise<void>;
  /** 加载草稿 */
  loadDraft(): Promise<HHPlayDraft | null>;
  /** 保存草稿 */
  saveDraft(): Promise<void>;
  /** 保存指定的草稿数据 */
  saveDraftWithData(draft: HHPlayDraft): Promise<void>;
  /** 清除草稿 */
  clearDraft(): Promise<void>;
  /** 断开连接 */
  disconnect(): Promise<void>;
}