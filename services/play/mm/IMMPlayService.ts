/**
 * @fileoverview AI 自对弈服务接口
 */

import type {
  IMMPlayConfig,
  IMMPlayState,
  PlayerColor,
  PlaySpeed,
} from './types';

/**
 * AI 自对弈回调接口
 */
export interface IMMPlayCallbacks {
  /** 棋盘变化回调 */
  onBoardChange?: (board: IMMPlayState['board']) => void;

  /** 玩家切换回调 */
  onPlayerChange?: (player: PlayerColor) => void;

  /** 落子回调 */
  onMove?: (
    x: number,
    y: number,
    color: PlayerColor,
    moveNum: number,
    captured?: Array<{x: number; y: number}>
  ) => void;

  /** 对局结束回调 */
  onGameEnd?: (
    blackScore: number,
    whiteScore: number,
    winner: PlayerColor
  ) => void;

  /** 状态变化回调 */
  onStatusChange?: (running: boolean, paused: boolean) => void;

  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * AI 自对弈服务接口
 * @ai-example
 * const service = new MMPlayService(katagoClient);
 * await service.setup({ modelId: 'katago-small', visits: 100, speed: 'normal' });
 * await service.start();
 */
export interface IMMPlayService {
  /**
   * 配置并准备自对弈
   * @param config - 自对弈配置
   * @param modelUrl - 模型 URL（可选）
   * @param onProgress - 进度回调（可选）
   */
  setup(config: IMMPlayConfig, modelUrl?: string, onProgress?: (loaded: number, total: number, progress: number) => void): Promise<void>;

  /**
   * 开始自对弈
   */
  start(): Promise<void>;

  /**
   * 暂停
   */
  pause(): void;

  /**
   * 继续
   */
  resume(): void;

  /**
   * 停止
   */
  stop(): void;

  /**
   * 单步执行（用于调试）
   * @returns 是否成功执行
   */
  step(): Promise<boolean>;

  /**
   * 获取当前状态
   */
  getState(): IMMPlayState;

  /**
   * 设置回调
   * @param callbacks - 回调函数
   */
  setCallbacks(callbacks: IMMPlayCallbacks): void;

  /**
   * 设置速度
   * @param speed - 对弈速度
   */
  setSpeed(speed: PlaySpeed): void;

  /**
   * 设置 visits
   * @param visits - 计算量
   */
  setVisits(visits: number): void;

  /**
   * 导出 SGF
   */
  exportSgf(): string;

  /**
   * 保存草稿
   */
  saveDraft(): Promise<void>;

  /**
   * 加载草稿
   */
  loadDraft(): Promise<import('./MMPlayDraftTypes').MMPlayDraft | null>;

  /**
   * 清除草稿
   */
  clearDraft(): Promise<void>;

  /**
   * 从草稿恢复游戏状态
   */
  restoreFromDraft(draft: import('./MMPlayDraftTypes').MMPlayDraft): Promise<void>;

  /**
   * 形势判断
   * @returns 黑方胜率和目差
   */
  analyzePosition(): Promise<{ winRate: number; scoreLead: number }>;

  /**
   * AI 数目（对局结束时判断胜负）
   * @returns 胜负结果
   */
  finalScore(): Promise<{ winner: 'black' | 'white'; margin: number; sgfResult: string }>;
}
