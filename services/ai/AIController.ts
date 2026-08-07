/**
 * @fileoverview 公共 AI 控制器
 * @description 整合 KataGo 调用，支持初始化、落子生成、形势判断、数子等功能
 */

import type { IAIEngine, AnalyzeOptions } from '../../infrastructure/ai';
import { forceUseWebAdapter } from '../../infrastructure/ai';
import type { BoardState, PlayerColor } from '../../domain';
import type { IAIController } from './IAIController';
import type { Difficulty, IAnalysisResult, IMoveAnalysis } from './types';
import { DifficultyManager } from './DifficultyManager';

/**
 * 公共 AI 控制器
 *
 * 直接使用 KataGo 客户端进行 AI 操作，统一服务于 HH、HM、MM 三种模式。
 */
export class AIController implements IAIController {
  private engine: IAIEngine | null;
  private difficultyManager: DifficultyManager;
  private thinking = false;
  private canceled = false;
  private modelId: string | null = null;
  private modelUrl: string | null = null;
  private modelFileName: string | null = null;
  private initialized = false;

  /**
   * 创建 AI 控制器
   * @param engine - AI 引擎（可选，用于依赖注入）
   * @param difficulty - 初始难度
   */
  constructor(engine?: IAIEngine, difficulty: Difficulty = 'medium') {
    this.engine = engine ?? null;
    this.difficultyManager = new DifficultyManager(difficulty);
  }

  async init(modelId: string, modelUrl?: string, onProgress?: (loaded: number, total: number, progress: number) => void, onInitProgress?: (info: { stage: string; message: string; current?: number; total?: number }) => void): Promise<void> {
    // 提取新模型的文件名
    const newModelFileName = modelUrl?.split('/').pop() ?? `${modelId}.bin.gz`;
    
    // 如果已初始化且模型文件名不同，先关闭旧引擎
    if (this.initialized && this.engine && this.modelFileName !== newModelFileName) {
      console.info('[AIController] Switching model:', this.modelFileName, '->', newModelFileName);
      if ('shutdown' in this.engine && typeof (this.engine as any).shutdown === 'function') {
        await (this.engine as any).shutdown();
      }
      this.initialized = false;
    }

    this.modelId = modelId;
    this.modelUrl = modelUrl ?? `/models/${modelId}.bin.gz`;
    this.modelFileName = newModelFileName;

    if (!this.engine) {
      console.error('[AIController] AI engine not provided');
      throw new Error('AI engine not provided. Please inject via constructor.');
    }

    try {
      await this.engine.init({
        modelUrl: this.modelUrl,
        onProgress,
        onInitProgress,
      });
      this.initialized = true;
    } catch (error: any) {
      console.error('[AIController] engine.init() failed:', error);
      
      // Fallback to WebAdapter if native KataGo is unavailable
      if (error?.code === 'KATAGO_NATIVE_UNAVAILABLE') {
        console.warn('[AIController] Native KataGo unavailable, fallback to WebAdapter');
        this.engine = forceUseWebAdapter();
        await this.engine.init({
          modelUrl: this.modelUrl!,
          onProgress,
          onInitProgress,
        });
        this.initialized = true;
        console.info('[AIController] Fallback to WebAdapter successful');
        return;
      }
      
      throw error;
    }
  }

  async genmove(
    board: BoardState,
    previousBoard: BoardState | null,
    currentPlayer: PlayerColor,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number,
    visits?: number,  // AI 搜索深度，不传则使用内部默认值
    maxTimeMs?: number,
    initialStones?: Array<{ player: PlayerColor; x: number; y: number }>  // 让子棋
  ): Promise<{ x: number; y: number; winRate: number; scoreLead: number } | null> {
    this.thinking = true;
    this.canceled = false;

    try {
      const actualVisits = Math.max(10, visits ?? this.difficultyManager.getVisits());

      const result = await this.callAnalyze(
        board, previousBoard, currentPlayer, moveHistory, komi, actualVisits, maxTimeMs, undefined, initialStones
      );

      if (this.canceled || !result.moves.length) return null;

      // 返回最佳着法（order 为 0）+ 胜率和目差
      const best = result.moves.find((m: { order: number; x: number; y: number }) => m.order === 0) ?? result.moves[0];
      return { 
        x: best!.x, 
        y: best!.y, 
        winRate: result.rootWinRate, 
        scoreLead: result.rootScoreLead 
      };
    } finally {
      this.thinking = false;
    }
  }

  async analyze(
    board: BoardState,
    previousBoard: BoardState | null,
    currentPlayer: PlayerColor,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number,
    visits?: number,
    maxTimeMs?: number,
    analysisPvLen?: number,  // PV长度，0表示不获取PV
    initialStones?: Array<{ player: PlayerColor; x: number; y: number }>  // 让子棋
  ): Promise<IAnalysisResult> {
    const actualVisits = visits ?? this.difficultyManager.getVisits();
    const result = await this.callAnalyze(
      board, previousBoard, currentPlayer, moveHistory, komi, actualVisits, maxTimeMs, analysisPvLen, initialStones
    );

    return {
      winRate: result.rootWinRate,
      scoreLead: result.rootScoreLead,
      topMoves: result.moves.map((m: { x: number; y: number; winRate: number; scoreLead: number; visits: number; pv?: string[] }) => ({
        x: m.x,
        y: m.y,
        winRate: m.winRate,
        scoreLead: m.scoreLead,
        visits: m.visits,
        pv: m.pv,  // 保留 PV line
      })),
    };
  }

  async countTerritory(
    board: BoardState,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number
  ): Promise<number> {
    // 数子是在官子收完后确认领地，棋局已定型，使用 100 visits 足够
    const result = await this.callAnalyze(board, null, 'black', moveHistory, komi, 100);
    // scoreLead 是当前玩家视角，black 视角即黑方领先
    return result.rootScoreLead;
  }

  cancel(): void {
    this.canceled = true;
    // IAIEngine 接口暂不支持 cancel
    // 如果需要取消功能，需要扩展接口
  }

  isThinking(): boolean {
    return this.thinking;
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficultyManager.setDifficulty(difficulty);
  }

  getDifficulty(): Difficulty {
    return this.difficultyManager.getDifficulty();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async evaluateBatch(
    positions: Array<{
      board: BoardState;
      previousBoard?: BoardState | null;
      currentPlayer: PlayerColor;
      moveHistory: Array<{ x: number; y: number; player: PlayerColor }>;
      komi: number;
    }>
  ): Promise<Array<{ winRate: number; scoreLead: number }>> {
    this.ensureInitialized();

    const result = await this.engine!.evaluateBatch({
      modelUrl: this.modelUrl!,
      positions: positions.map(p => ({
        board: p.board,
        previousBoard: p.previousBoard ?? undefined,
        currentPlayer: p.currentPlayer,
        moveHistory: p.moveHistory,
        komi: p.komi,
      })),
    });

    return result.map((r: { rootWinRate: number; rootScoreLead: number }) => ({
      winRate: r.rootWinRate,
      scoreLead: r.rootScoreLead,
    }));
  }

  async analyzeGame(
    moves: Array<{ player: PlayerColor; x: number; y: number }>,
    komi: number,
    options?: {
      visits?: number;
      analyzeTurns?: number[];
      includeOwnership?: boolean;
      includePv?: boolean;
      rules?: string;
      initialStones?: Array<{ player: PlayerColor; x: number; y: number }>;
      onResultProgress?: (current: number, total: number) => void;
    }
  ): Promise<Array<{
    turnNumber: number;
    winRate: number;
    scoreLead: number;
    visits: number;
    topMoves: Array<{
      move: string;
      winRate: number;
      scoreLead: number;
      visits: number;
      prior: number;
      pv: string[];
    }>;
    ownership?: number[];
  }>> {
    this.ensureInitialized();

    // 如果引擎支持 analyzeGame（App 原生），走批量路径
    if (this.engine!.analyzeGame) {
      const gameOpts: import('../../infrastructure/ai/IAIEngine').AnalyzeGameOptions = {
        moves: moves.map(m => ({
          player: m.player as 'black' | 'white',
          x: m.x,
          y: m.y,
        })),
        komi,
        rules: (options?.rules as 'chinese' | 'japanese' | 'korean' | 'tromp-taylor' | 'aga') ?? 'chinese',
      };
      
      // analysisPVLen 必须是 1 到 1000 之间的整数
      // 如果需要 PV，设置为 15；否则不传递（让 KataGo 使用配置文件的默认值）
      if (options?.includePv) {
        gameOpts.analysisPVLen = 15;
      }
      
      if (options?.visits !== undefined) gameOpts.maxVisits = options.visits;
      if (options?.analyzeTurns !== undefined) gameOpts.analyzeTurns = options.analyzeTurns;
      if (options?.includeOwnership !== undefined) gameOpts.includeOwnership = options.includeOwnership;
      if (options?.initialStones !== undefined) gameOpts.initialStones = options.initialStones;
      if (options?.onResultProgress !== undefined) gameOpts.onResultProgress = options.onResultProgress;

      const result = await this.engine!.analyzeGame(gameOpts);

      return result.map(turn => {
        const mapped: {
          turnNumber: number;
          winRate: number;
          scoreLead: number;
          visits: number;
          topMoves: Array<{ move: string; winRate: number; scoreLead: number; visits: number; prior: number; pv: string[] }>;
          ownership?: number[];
        } = {
          turnNumber: turn.turnNumber,
          winRate: turn.rootWinRate,
          scoreLead: turn.rootScoreLead,
          visits: turn.rootVisits,
          topMoves: turn.moveInfos.map(mi => ({
            move: mi.move,
            winRate: mi.winrate,
            scoreLead: mi.scoreLead,
            visits: mi.visits,
            prior: mi.prior,
            pv: mi.pv,
          })),
        };
        if (turn.ownership != null) mapped.ownership = turn.ownership;
        return mapped;
      });
    }

    // Fallback: 逐手串行分析
    const results: Array<{
      turnNumber: number;
      winRate: number;
      scoreLead: number;
      visits: number;
      topMoves: Array<{ move: string; winRate: number; scoreLead: number; visits: number; prior: number; pv: string[] }>;
      ownership?: number[];
    }> = [];

    const turnsToAnalyze = options?.analyzeTurns ?? moves.map((_, i) => i);

    for (const turnIdx of turnsToAnalyze) {
      const moveHistory = moves.slice(0, turnIdx);
      const currentPlayer = turnIdx < moves.length ? moves[turnIdx]!.player : (moves[moves.length - 1]!.player === 'black' ? 'white' : 'black');

      // fallback 逐手分析需要 board，这里用空棋盘占位，由 moveHistory 推导
      const analysis = await this.analyze(
        {} as BoardState,
        {} as BoardState | null,
        currentPlayer,
        moveHistory.map(m => ({ x: m.x, y: m.y, player: m.player })),
        komi,
        options?.visits,
        undefined,
        options?.includePv ? 15 : 0,
      );

      results.push({
        turnNumber: turnIdx,
        winRate: analysis.winRate,
        scoreLead: analysis.scoreLead,
        visits: 0,
        topMoves: analysis.topMoves.map(m => ({
          move: `${m.x},${m.y}`,
          winRate: m.winRate,
          scoreLead: m.scoreLead,
          visits: m.visits,
          prior: 0,
          pv: m.pv ?? [],
        })),
      });
    }

    return results;
  }

  destroy(): void {
    this.engine = null;
    this.initialized = false;
    this.modelId = null;
    this.modelUrl = null;
    this.modelFileName = null;
    this.thinking = false;
    this.canceled = false;
  }

  getModelId(): string | null {
    return this.modelId;
  }

  getModelFileName(): string | null {
    return this.modelFileName;
  }

  private async callAnalyze(
    board: BoardState,
    previousBoard: BoardState | null,
    currentPlayer: PlayerColor,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number,
    visits: number,
    maxTimeMs?: number,
    analysisPvLen?: number,  // PV长度，0表示不获取PV
    initialStones?: Array<{ player: PlayerColor; x: number; y: number }>  // 让子棋
  ) {
    this.ensureInitialized();

    const options: AnalyzeOptions = {
      modelUrl: this.modelUrl ?? `/models/${this.modelId}.bin.gz`,
      board,
      currentPlayer,
      moveHistory: moveHistory.map((m) => ({ x: m.x, y: m.y, player: m.player })),
      komi,
      visits,
      maxTimeMs: maxTimeMs ?? 30000,
    };

    if (previousBoard) options.previousBoard = previousBoard;
    
    // 设置PV长度（0表示不获取PV，速度更快）
    if (analysisPvLen !== undefined) {
      options.analysisPvLen = analysisPvLen;
    }
    
    // 设置让子棋
    if (initialStones && initialStones.length > 0) {
      options.initialStones = initialStones;
    }

    return this.engine!.analyze(options);
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.engine) {
      throw new Error('AIController not initialized. Call init() first.');
    }
  }
}
