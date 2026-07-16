/** @fileoverview 人机对弈服务实现 */
import type { IHMPlayConfig, IHMPlayState, IAnalysisResult } from './types';
import type { IHMPlayService } from './IHMPlayService';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';
import type { IHMPlayServiceConfig } from '../../../infrastructure/config/schemas/HMPlayConfigSchema';
import type { HMPlayDraft } from './HMPlayDraftTypes';
import type { IGame } from '../../../domain/game/IGame';
import type { PlayerColor, BoardState } from '../../../domain';
import type { Difficulty } from '../../ai/types';
import { AIController } from '../../ai/AIController';
import { HMGameStateManager } from './HMGameStateManager';
import { HMNotifier } from './HMNotifier';
import { HMPlayDraftManager } from './HMPlayDraftManager';
import { HMPlayAIMover } from './HMPlayAIMover';
import { HMPlayConfigLoader } from './HMPlayConfigLoader';
import { getBoardState, toSimpleMove } from './HMUtils';
import { SGFWriter } from '../../../domain/sgf';

/** 人机对弈服务 */
export class HMPlayService implements IHMPlayService {
  private game: IGame;
  private aiController: AIController;
  private gameState = new HMGameStateManager();
  private notifier = new HMNotifier();
  private configLoader: HMPlayConfigLoader;
  private draftManager = new HMPlayDraftManager();
  private currentModelUrl: string | null = null;
  private aiMover: HMPlayAIMover;
  private sgfWriter = new SGFWriter();
  private previousBoard: BoardState | null = null; // 用于打劫判断

  constructor(game: IGame, aiController: AIController, configProvider?: IConfigProvider) {
    this.game = game;
    this.aiController = aiController;
    this.configLoader = new HMPlayConfigLoader(configProvider);
    this.aiMover = new HMPlayAIMover(
      game,
      aiController,
      this.notifier,
      () => this.previousBoard,
      (board) => { this.previousBoard = board; }
    );
  }

  /** 获取服务级配置（带缓存） */
  private async getServiceConfig(): Promise<IHMPlayServiceConfig> {
    return this.configLoader.getConfig();
  }

  async newGame(config: IHMPlayConfig): Promise<void> {
    const defaults = await this.getServiceConfig();
    const merged: IHMPlayConfig = {
      playerColor: config.playerColor,
      handicap: config.handicap,
      difficulty: config.difficulty ?? defaults.defaultDifficulty,
      noUndo: config.noUndo ?? defaults.defaultNoUndo,
      modelId: config.modelId ?? defaults.defaultModelId,
      visits: config.visits ?? defaults.defaultVisits[config.difficulty ?? defaults.defaultDifficulty],
      modelUrl: config.modelUrl,
      onProgress: config.onProgress,
    };

    this.gameState.reset();
    this.gameState.setConfig(merged);
    
    // 计算让子后的贴目
    // 标准规则：让 N 子，贴目减少 N 目
    const baseKomi = 7.5;
    const handicapKomi = baseKomi - (merged.handicap ?? 0);
    
    this.game.newGame({ 
      handicap: merged.handicap, 
      playerColor: merged.playerColor,
      komi: handicapKomi,
    });
    this.aiController.setDifficulty(merged.difficulty);
    this.previousBoard = null; // 重置打劫判断

    if (!this.aiController.isInitialized()) {
      // 使用传入的 modelUrl，或根据 modelId 构建路径
      const finalModelUrl = config.modelUrl ?? `/models/${merged.modelId}.bin.gz`;
      await this.aiController.init(merged.modelId, finalModelUrl, merged.onProgress);
      this.currentModelUrl = finalModelUrl;
    }

    this.notifier.notifyBoardChange(getBoardState(this.game.getState().board));
    this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);

    // 保存草稿
    await this.saveDraft();

    // 让子情况下，黑方已经有让子棋子，白方先行
    // 如果玩家执白，AI（黑方）已经放置让子，玩家直接落子
    // 如果玩家执黑，AI（白方）需要先落子
    if (merged.playerColor === 'white' && merged.handicap === 0) {
      // 不让子且玩家执白，AI 先落子
      await this.aiMove();
    } else if (merged.playerColor === 'black' && merged.handicap > 0) {
      // 让子且玩家执黑，AI（白方）先落子
      await this.aiMove();
    }
    // 其他情况：
    // - 不让子且玩家执黑：玩家先落子
    // - 让子且玩家执白：玩家（白方）先落子
  }

  async playerMove(x: number, y: number): Promise<boolean> {
    if (!this.isPlayerTurn() || this.isEnded()) return false;

    // 保存当前棋盘状态用于打劫判断
    this.previousBoard = getBoardState(this.game.getState().board);
    
    // 保存当前玩家（落子前），用于正确的提子提示
    const movePlayer = this.game.getState().currentPlayer;

    this.gameState.resetPasses();
    const result = this.game.placeStone(x, y);
    if (!result.success) {
      this.previousBoard = null; // 落子失败，重置
      return false;
    }

    this.notifier.notifyBoardChange(getBoardState(this.game.getState().board));
    this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);
    if (result.captured.length > 0) {
      // 使用落子玩家的颜色，而不是当前玩家（已变为对方）
      this.notifier.notifyCapture(result.captured.length, movePlayer);
    }

    // 保存草稿
    await this.saveDraft();

    await this.aiMove();
    return true;
  }

  async playerPass(): Promise<void> {
    if (!this.isPlayerTurn() || this.isEnded()) return;

    // 保存当前棋盘状态用于打劫判断
    this.previousBoard = getBoardState(this.game.getState().board);

    const passes = this.gameState.incrementPasses();
    this.game.pass();
    this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);

    // 保存草稿
    await this.saveDraft();

    if (passes >= 2) {
      await this.endGame();
      return;
    }
    await this.aiMove();
  }

  async undo(): Promise<boolean> {
    if (!this.canUndo() || this.aiController.isThinking()) return false;

    const success = this.game.undo();
    if (success && this.isAiTurn()) this.game.undo();

    this.notifier.notifyBoardChange(getBoardState(this.game.getState().board));
    this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);
    
    // 保存草稿
    await this.saveDraft();
    
    return true;
  }

  async analyze(): Promise<IAnalysisResult> {
    const state = this.game.getState();
    const moves = this.getMoveHistory();
    
    // 获取初始让子棋子
    const handicapStones = this.game.getHandicapStones();
    const initialStones = handicapStones.map(s => ({
      player: (s.color === 'B' ? 'black' : 'white') as PlayerColor,
      x: s.x,
      y: s.y,
    }));
    
    return this.aiController.analyze(
      getBoardState(state.board),
      this.previousBoard, // 传递 previousBoard 用于打劫判断
      state.currentPlayer,
      moves,
      state.komi,
      200,
      undefined, // maxTimeMs
      0, // analysisPvLen
      initialStones.length > 0 ? initialStones : undefined
    );
  }

  async resign(): Promise<void> {
    if (this.isEnded()) return;
    const config = this.gameState.getConfig();
    const winner = config?.playerColor === 'black' ? 'white' : 'black';
    await this.endGame(winner, '认输');
  }

  getState(): IHMPlayState {
    const state = this.game.getState();
    return {
      board: getBoardState(state.board),
      currentPlayer: state.currentPlayer,
      moveHistory: this.getMoveHistory(),
      capturedBlack: state.capturedBlack,
      capturedWhite: state.capturedWhite,
      scoreLead: 0,
      isAiThinking: this.aiController.isThinking(),
      gameEnded: state.phase === 'ended',
    };
  }

  setCallbacks(callbacks: Parameters<HMNotifier['setCallbacks']>[0]): void {
    this.notifier.setCallbacks(callbacks);
  }

  setDifficulty(difficulty: Difficulty): void {
    this.aiController.setDifficulty(difficulty as unknown as import('../../ai/types').Difficulty);
  }

  async setModel(modelId: string): Promise<void> {
    await this.aiController.init(modelId);
  }

  cancelAiThinking(): void {
    this.aiController.cancel();
  }

  isPlayerTurn(): boolean {
    return this.gameState.isPlayerTurn(this.game.getState().currentPlayer);
  }

  isEnded(): boolean {
    return this.game.getState().phase === 'ended';
  }

  canUndo(): boolean {
    return this.gameState.canUndo(this.game.getState().moveHistory.length);
  }

  /** 导出 SGF */
  exportSgf(): string {
    const moves = this.getMoveHistory();
    const state = this.getState();
    
    // 转换为 SGFWriter 需要的格式
    const sgfMoves = moves.map((m, index) => ({
      x: m.x,
      y: m.y,
      color: m.player,
      number: index + 1,
    }));
    
    // 获取玩家信息
    const config = this.gameState.getConfig();
    const blackName = config?.playerColor === 'black' ? '玩家' : 'AI';
    const whiteName = config?.playerColor === 'white' ? '玩家' : 'AI';
    
    // 获取让子棋信息
    const handicapStones = this.game.getHandicapStones();
    
    // 生成结果（如果有）
    let result: string | undefined;
    if (state.gameEnded && state.winner) {
      result = state.winner === 'black' ? 'B+R' : 'W+R';
    }
    
    return this.sgfWriter.write(sgfMoves, {
      size: 19,
      blackName,
      whiteName,
      komi: 7.5,
      result,
      date: new Date().toISOString().split('T')[0],
      handicapStones,
    });
  }

  /**
   * 计算最终数目
   * @returns 胜者、目差和 SGF 结果字符串
   */
  async finalScore(): Promise<{ winner: 'black' | 'white'; margin: number; sgfResult: string }> {
    const state = this.game.getState();
    const moves = this.getMoveHistory();
    
    // 调用数子接口（使用 500 visits 确保准确）
    const scoreLead = await this.aiController.countTerritory(
      getBoardState(state.board),
      moves,
      state.komi
    );
    
    // 确定胜负（scoreLead 是黑方视角，正表示黑方领先）
    const winner: 'black' | 'white' = scoreLead > 0 ? 'black' : 'white';
    const margin = Math.abs(scoreLead);
    
    // 生成 SGF 结果字符串
    const sgfResult = winner === 'black' 
      ? `B+${margin.toFixed(1)}` 
      : `W+${margin.toFixed(1)}`;
    
    return {
      winner,
      margin,
      sgfResult,
    };
  }

  private async aiMove(): Promise<void> {
    if (this.isEnded()) return;
    
    // 获取用户设置的 visits
    const config = this.gameState.getConfig();
    const visits = config?.visits;
    
    await this.aiMover.move(
      () => this.gameState.incrementPasses(),
      () => this.gameState.resetPasses(),
      () => this.saveDraft(),
      visits  // 传递 visits，不再是 difficulty
    );
    
    // 检查是否双方虚手
    const passes = this.gameState.getConsecutivePasses();
    if (passes >= 2) {
      await this.endGame();
    }
  }

  private async endGame(winner?: PlayerColor, reason = '双方虚手'): Promise<void> {
    let finalWinner = winner;
    let finalReason = reason;
    
    // 如果没有指定胜者（双方虚手），调用 KataGo 数目
    if (!finalWinner) {
      try {
        const result = await this.finalScore();
        finalWinner = result.winner;
        finalReason = `${result.winner === 'black' ? '黑方' : '白方'}胜 ${result.margin.toFixed(1)} 目`;
      } catch (error) {
        console.error('[HMPlayService] 数目失败', error);
        finalWinner = 'black'; // fallback
        finalReason = '数目失败，默认黑方胜';
      }
    }
    
    // 清除草稿（对局结束）
    this.draftManager.clear();
    this.notifier.notifyGameEnd(finalWinner ?? 'black', finalReason);
  }

  private isAiTurn(): boolean {
    return !this.isPlayerTurn();
  }

  private getMoveHistory(): Array<{ x: number; y: number; player: PlayerColor }> {
    return this.game
      .getState()
      .moveHistory.map(toSimpleMove)
      .filter((m): m is { x: number; y: number; player: PlayerColor } => m !== null);
  }

  // ========== 草稿管理 ==========

  /**
   * 保存草稿
   */
  async saveDraft(): Promise<void> {
    const state = this.game.getState();
    const config = this.gameState.getConfig();
    
    if (!config) return;
    
    const draft: HMPlayDraft = {
      board: getBoardState(state.board),
      currentPlayer: state.currentPlayer,
      playerColor: config.playerColor,
      difficulty: config.difficulty,
      ...(config.visits !== undefined && { visits: config.visits }), // 保存 visits
      handicap: config.handicap,
      modelId: config.modelId, // 保存 modelId
      ...(this.currentModelUrl && { modelUrl: this.currentModelUrl }), // 保存自定义模型 URL
      moveCount: state.moveHistory.length,
      moveHistory: this.getMoveHistory(),
      gameEnded: state.phase === 'ended',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.draftManager.save(draft);
  }

  /**
   * 加载草稿
   */
  async loadDraft(): Promise<HMPlayDraft | null> {
    return this.draftManager.load();
  }

  /**
   * 清除草稿
   */
  async clearDraft(): Promise<void> {
    this.draftManager.clear();
  }

  /**
   * 从草稿恢复游戏状态
   */
  async restoreFromDraft(draft: HMPlayDraft, modelUrl?: string): Promise<void> {
    // 恢复配置
    this.gameState.setConfig({
      playerColor: draft.playerColor,
      difficulty: draft.difficulty,
      ...(draft.visits !== undefined && { visits: draft.visits }), // 恢复 visits
      handicap: draft.handicap,
      noUndo: false,
      modelId: draft.modelId, // 使用草稿中的 modelId
    });

    // 恢复游戏状态
    this.game.newGame({
      handicap: draft.handicap,
      playerColor: draft.playerColor,
    });

    // 重放历史记录
    for (const move of draft.moveHistory) {
      if (move.x === -1 && move.y === -1) {
        // Pass 的特殊坐标
        this.game.pass();
      } else {
        this.game.placeStone(move.x, move.y);
      }
    }

    // 检查并初始化 AI Controller（如果需要）
    const modelId = draft.modelId ?? 'katago-small';
    // 优先使用草稿中保存的 URL，其次使用页面传入的，最后 fallback
    const resolvedModelUrl = draft.modelUrl ?? modelUrl ?? `/models/${modelId}.bin.gz`;
    if (!this.aiController.isInitialized()) {
      await this.aiController.init(modelId, resolvedModelUrl);
    } else if (this.aiController.getModelId() !== modelId) {
      // 如果当前模型与草稿中的模型不同，重新初始化
      await this.aiController.init(modelId, resolvedModelUrl);
    }
    this.currentModelUrl = resolvedModelUrl;

    // 通知状态变化
    this.notifier.notifyBoardChange(getBoardState(this.game.getState().board));
    this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);
    
    // 判断是否轮到 AI 落子
    if (!this.isPlayerTurn()) {
      // 轮到 AI，触发 AI 落子
      await this.aiMove();
    }
  }
}
