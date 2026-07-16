/**
 * @fileoverview 人机对弈服务接口
 */

import type {
  IHMPlayConfig,
  IHMPlayState,
  IHMPlayCallbacks,
  IAnalysisResult,
  Difficulty,
} from './types';
import type { PlayerColor } from '../../../domain';

/**
 * 人机对弈服务接口
 *
 * 提供完整的人机对弈功能，包括游戏管理、AI 对手、形势判断等。
 *
 * @ai-example
 * const service: IHMPlayService = new HMPlayService(game, aiController);
 * await service.newGame({
 *   playerColor: 'black',
 *   handicap: 0,
 *   difficulty: 'medium',
 *   noUndo: false,
 *   modelId: 'katago-small'
 * });
 *
 * service.setCallbacks({
 *   onBoardChange: (board) => renderBoard(board),
 *   onAiMove: (x, y) => playSound()
 * });
 *
 * await service.playerMove(3, 3);
 */
export interface IHMPlayService {
  /**
   * 开始新游戏
   * @param config - 游戏配置
   * @ai-example
   * await service.newGame({ playerColor: 'black', handicap: 0, difficulty: 'medium', noUndo: false, modelId: 'katago-small' });
   */
  newGame(config: IHMPlayConfig): Promise<void>;

  /**
   * 玩家落子
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 是否成功
   * @ai-example
   * const success = await service.playerMove(3, 3);
   */
  playerMove(x: number, y: number): Promise<boolean>;

  /**
   * 玩家虚手（停一手）
   * @ai-example
   * await service.playerPass();
   */
  playerPass(): Promise<void>;

  /**
   * 悔棋（如果允许）
   * @returns 是否成功
   * @ai-example
   * const success = await service.undo();
   */
  undo(): Promise<boolean>;

  /**
   * 请求形势判断
   * @returns 分析结果
   * @ai-example
   * const analysis = await service.analyze();
   */
  analyze(): Promise<IAnalysisResult>;

  /**
   * 认输
   * @ai-example
   * await service.resign();
   */
  resign(): Promise<void>;

  /**
   * 获取当前状态
   * @returns 游戏状态
   * @ai-example
   * const state = service.getState();
   */
  getState(): IHMPlayState;

  /**
   * 设置回调
   * @param callbacks - 回调函数集合
   * @ai-example
   * service.setCallbacks({ onBoardChange: (b) => render(b) });
   */
  setCallbacks(callbacks: IHMPlayCallbacks): void;

  /**
   * 切换难度
   * @param difficulty - 难度等级
   * @ai-example
   * service.setDifficulty('hard');
   */
  setDifficulty(difficulty: Difficulty): void;

  /**
   * 切换模型
   * @param modelId - 模型 ID
   * @ai-example
   * await service.setModel('katago-large');
   */
  setModel(modelId: string): Promise<void>;

  /**
   * 取消 AI 思考
   * @ai-example
   * service.cancelAiThinking();
   */
  cancelAiThinking(): void;

  /**
   * 检查是否轮到玩家
   * @returns 是否轮到玩家
   * @ai-example
   * if (service.isPlayerTurn()) { enableUserInput(); }
   */
  isPlayerTurn(): boolean;

  /**
   * 检查游戏是否已结束
   * @returns 是否已结束
   * @ai-example
   * if (service.isEnded()) { showResult(); }
   */
  isEnded(): boolean;

  /**
   * 检查是否允许悔棋
   * @returns 是否允许
   * @ai-example
   * undoBtn.disabled = !service.canUndo();
   */
  canUndo(): boolean;

  /**
   * 导出 SGF
   * @returns SGF 字符串
   * @ai-example
   * const sgf = service.exportSgf();
   * console.log(sgf);
   */
  exportSgf(): string;

  /**
   * 计算最终数目
   * @returns 胜者、目差和 SGF 结果字符串
   * @ai-example
   * const result = await service.finalScore();
   * console.log(result.winner, result.margin, result.sgfResult);
   */
  finalScore(): Promise<{ winner: 'black' | 'white'; margin: number; sgfResult: string }>;

  /**
   * 保存草稿
   * @ai-example
   * await service.saveDraft();
   */
  saveDraft(): Promise<void>;

  /**
   * 加载草稿
   * @returns 草稿数据或 null
   * @ai-example
   * const draft = await service.loadDraft();
   */
  loadDraft(): Promise<import('./HMPlayDraftTypes').HMPlayDraft | null>;

  /**
   * 清除草稿
   * @ai-example
   * await service.clearDraft();
   */
  clearDraft(): Promise<void>;

  /**
   * 从草稿恢复游戏状态
   * @param draft - 草稿数据
   * @param modelUrl - 模型 URL（自定义模型必须传入，否则用 modelId 构造本地路径）
   * @ai-example
   * await service.restoreFromDraft(draft, modelUrl);
   */
  restoreFromDraft(draft: import('./HMPlayDraftTypes').HMPlayDraft, modelUrl?: string): Promise<void>;
}