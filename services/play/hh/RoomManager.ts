/**
 * @fileoverview 房间管理 - 房间创建和状态管理
 */

import type { IRoomInfo, IPlayerInfo, PlayerColor, IHHPlayConfig } from './types';

/** 房间状态 */
export interface IRoomState {
  room: IRoomInfo | null;
  me: IPlayerInfo | null;
  opponent: IPlayerInfo | null;
}

/**
 * 房间管理器
 * @ai-example
 * const manager = new RoomManager();
 * const room = manager.createRoom('玩家A', { timeLimit: 30 }, 'black');
 * manager.joinRoom(room.id, '玩家B');
 */
export class RoomManager {
  private state: IRoomState = {
    room: null,
    me: null,
    opponent: null,
  };

  /** 创建房间 */
  createRoom(name: string, config: Partial<IHHPlayConfig>, color: PlayerColor): IRoomInfo {
    const roomId = this.generateRoomId();
    const room: IRoomInfo = {
      id: roomId,
      creatorName: name,
      creatorColor: color,
      handicap: config.handicap ?? 0,
      timeLimit: config.timeLimit ?? 30,
      createdAt: Date.now(),
    };

    this.state.room = room;
    this.state.me = {
      name,
      color,
      isCreator: true,
    };

    return room;
  }

  /** 加入房间 */
  joinRoom(roomId: string, name: string, roomInfo: Partial<IRoomInfo>): IPlayerInfo {
    const opponentColor = roomInfo.creatorColor ?? 'black';
    const myColor = opponentColor === 'black' ? 'white' : 'black';

    this.state.room = {
      id: roomId,
      creatorName: roomInfo.creatorName ?? '',
      creatorColor: opponentColor,
      handicap: roomInfo.handicap ?? 0,
      timeLimit: roomInfo.timeLimit ?? 30,
      createdAt: roomInfo.createdAt ?? Date.now(),
    };

    this.state.me = {
      name,
      color: myColor,
      isCreator: false,
    };

    return this.state.me;
  }

  /** 设置对手信息 */
  setOpponent(name: string): IPlayerInfo {
    const myColor = this.state.me?.color ?? 'black';
    const opponentColor = myColor === 'black' ? 'white' : 'black';

    const player: IPlayerInfo = {
      name,
      color: opponentColor,
      isCreator: !this.state.me?.isCreator,
    };

    this.state.opponent = player;
    return player;
  }

  /** 恢复房间状态（用于断线重连） */
  restoreRoom(room: IRoomInfo, me: IPlayerInfo): void {
    this.state.room = room;
    this.state.me = me;
  }

  /** 获取房间状态 */
  getState(): IRoomState {
    return this.state;
  }

  /** 清除房间状态 */
  clear(): void {
    this.state = {
      room: null,
      me: null,
      opponent: null,
    };
  }

  /** 生成房间 ID（6位） */
  private generateRoomId(): string {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  }
}