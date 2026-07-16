/**
 * @fileoverview 房间控制器 - 处理房间相关操作
 * @description 封装创建房间、加入房间、离开房间等逻辑
 */
import type { HHPlayApp } from '../../../../../../application/play';
import type { IToast } from '../../../../../core/interfaces';
import type { PlayerColor } from '../../../../../core/types';
/** 房间配置 */
export interface RoomConfig {
  name: string;
  color: 'black' | 'white' | 'random';
  handicap: number;
  timeLimit: number;
}
/** 房间信息 */
export interface RoomInfo {
  roomId: string;
  creatorColor: PlayerColor;
  creatorName: string;
  handicap: number;
  timeLimit: number;
}
/** 房间控制器配置 */
export interface HHRoomControllerConfig {
  hhPlayApp: HHPlayApp;
  toast: IToast;
}
/** 玩家名称缓存 */
let playerNameCache: string = (typeof localStorage !== 'undefined' ? localStorage.getItem('weiqi-player-name') : null) ?? '';
/**
 * 生成随机名称
 */
export function generateRandomName(): string {
  const p = ['天','地','风','云','雷','电','山','水','星','月','龙','虎','鹰','狼','狐','熊','鹏','麟','鹤','雀'];
  const s = ['弈','棋','客','士','仙','圣','王','君','子','灵','影','魂','心','剑','刃'];
  return (p[Math.floor(Math.random() * p.length)] ?? '天') + (s[Math.floor(Math.random() * s.length)] ?? '弈');
}
/**
 * 获取玩家名称缓存
 */
export function getPlayerNameCache(): string {
  return playerNameCache;
}
/**
 * 设置玩家名称缓存
 */
export function setPlayerNameCache(name: string): void {
  playerNameCache = name;
  localStorage.setItem('weiqi-player-name', name);
}
/**
 * 房间控制器
 * @description 负责房间的创建、加入、离开等操作
 */
export class HHRoomController {
  private hhPlayApp: HHPlayApp;
  private toast: IToast;
  constructor(config: HHRoomControllerConfig) {
    this.hhPlayApp = config.hhPlayApp;
    this.toast = config.toast;
  }
  /**
   * 创建房间
   * @returns 房间信息
   */
  async createRoom(config: RoomConfig): Promise<RoomInfo> {
    const name = config.name || generateRandomName();
    setPlayerNameCache(name);
    const actualColor = config.color === 'random'
      ? (Math.random() > 0.5 ? 'black' : 'white')
      : config.color;
    try {
      const roomInfo = await this.hhPlayApp.createRoom(name, {
        timeLimit: config.timeLimit,
        handicap: config.handicap,
        soundEnabled: true,
        signalingUrl: '',
        color: actualColor,
      });
      this.toast.success('房间创建成功！');
      return {
        roomId: roomInfo.id,
        creatorColor: roomInfo.creatorColor,
        creatorName: name,
        handicap: config.handicap,
        timeLimit: config.timeLimit,
      };
    } catch (error) {
      this.toast.error('创建房间失败: ' + (error as Error).message);
      console.error('创建房间失败', error as Error);
      throw error;
    }
  }
  /**
   * 加入房间
   * @returns 玩家信息和房间信息
   */
  async joinRoom(roomId: string, name?: string): Promise<{
    player: { name: string; color: PlayerColor };
    roomInfo?: {
      creatorName: string;
      creatorColor: PlayerColor;
      handicap: number;
      timeLimit: number;
    };
  }> {
    const playerName = name || generateRandomName();
    setPlayerNameCache(playerName);
    if (!roomId || roomId.length !== 6) {
      this.toast.warning('请输入6位房间ID');
      throw new Error('请输入6位房间ID');
    }
    try {
      const player = await this.hhPlayApp.joinRoom(roomId, playerName);
      const roomInfo = this.hhPlayApp.getRoomInfo();
      return {
        player: { name: playerName, color: player.color },
        ...(roomInfo ? { roomInfo } : {}),
      };
    } catch (error) {
      console.error('[HHRoomController] 加入房间失败', error);
      this.toast.error('加入房间失败: ' + (error as Error).message);
      console.error('加入房间失败', error as Error);
      throw error;
    }
  }
  /**
   * 确认加入房间
   */
  async confirmJoin(name: string): Promise<{ color: PlayerColor }> {
    setPlayerNameCache(name);
    try {
      const player = await this.hhPlayApp.confirmJoin(name);
      this.toast.success('加入成功，对局开始！');
      return { color: player.color };
    } catch (error) {
      console.error('[HHRoomController] 确认加入失败', error);
      this.toast.error('加入失败: ' + (error as Error).message);
      console.error('确认加入失败', error as Error);
      throw error;
    }
  }
  /**
   * 离开房间
   */
  async leaveRoom(): Promise<void> {
    await this.hhPlayApp.leaveRoom();
  }
}
