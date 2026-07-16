/**
 * @fileoverview RecorderService 接口定义
 */

import type { IGameState, IMoveResult, IGameConfig } from '../../domain/game';
import type { IGameMetadata, OnUpdateCallback } from './types';

/**
 * 记谱编排服务接口
 * @description 管理游戏实例、处理UI交互、生成SGF、保存草稿
 * @ai-example
 * const service: IRecorderService = {
 *   placeStone: (x, y) => ({ success: true, captured: [] }),
 *   generateSGF: () => '(;SZ[19]...)',
 *   saveDraft: async () => { ... }
 * };
 */
export interface IRecorderService {
  // ===== 游戏管理 =====

  /**
   * 落子
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 落子结果
   */
  placeStone(x: number, y: number): IMoveResult;

  /**
   * 停一手
   */
  pass(): void;

  /**
   * 悔棋
   * @returns 是否成功
   */
  undo(): boolean;

  /**
   * 新建对局
   * @param config - 游戏配置
   */
  newGame(config?: IGameConfig): void;

  /**
   * 获取当前游戏状态
   * @returns 游戏状态
   */
  getState(): IGameState;

  // ===== SGF 生成 =====

  /**
   * 生成 SGF 字符串
   * @param metadata - 对局元数据
   * @returns SGF 文本
   */
  generateSGF(metadata?: IGameMetadata): string;

  // ===== 草稿管理 =====

  /**
   * 保存草稿
   */
  saveDraft(): Promise<void>;

  /**
   * 加载草稿
   */
  loadDraft(): Promise<void>;

  /**
   * 清除草稿
   */
  clearDraft(): Promise<void>;

  // ===== 回调通知 =====

  /**
   * 设置状态更新回调
   * @param callback - 回调函数
   */
  setOnUpdate(callback: OnUpdateCallback): void;
}
