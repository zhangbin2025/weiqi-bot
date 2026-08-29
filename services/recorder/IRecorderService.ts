/**
 * @fileoverview 记谱服务接口
 */

import type { IGameState, IMoveResult, IGameConfig } from '../../domain/game';
import type { PlayerColor } from '../../domain/primitives';
import type { IGameMetadata, OnUpdateCallback } from './types';

/**
 * 记谱服务接口
 */
export interface IRecorderService {
  /** 初始化游戏 */
  newGame(config?: Partial<IGameConfig>): void;
  
  /** 落子 */
  placeStone(x: number, y: number): IMoveResult;
  
  /** 撤销 */
  undo(): boolean;
  
  /** 停一手 */
  pass(): void;
  
  /** 获取当前状态 */
  getState(): IGameState;
  
  /** 设置更新回调 */
  onUpdate(callback: OnUpdateCallback): void;
  
  /** 播放音效 */
  playSound(type: 'stone' | 'capture' | 'pass' | 'undo'): void;
  
  /** 生成 SGF */
  generateSGF(): string;
  
  /** 下载 SGF */
  downloadSGF(metadata: IGameMetadata): Promise<void>;
  
  /** 保存到历史 */
  saveToHistory(metadata: IGameMetadata): Promise<string | null>;
  
  /** 保存草稿 */
  saveDraft(mode?: 'play' | 'setup'): Promise<void>;
  
  /** 加载草稿 */
  loadDraft(): Promise<{ mode: 'play' | 'setup' } | undefined>;
  
  /** 清除草稿 */
  clearDraft(): Promise<void>;
  
  /** 添加初始棋子 */
  addInitialStone(x: number, y: number, color: 'B' | 'W'): boolean;
  
  /** 移除初始棋子 */
  removeInitialStone(x: number, y: number): boolean;
  
  /** 设置先手方 */
  setInitialPlayer(color: PlayerColor): void;
}
