/**
 * @fileoverview KataGo Web 适配器
 * @description 使用 @weiqi/worker 实现 AI 引擎接口（Web 环境）
 */

import { getKataGoEngineClient, KataGoCanceledError, setWorkerUrl } from '@weiqi/worker';
import type { AnalysisResult } from '@weiqi/worker';
import type {
  IAIEngine,
  AIEngineInitOptions,
  AnalyzeOptions,
  EvaluateOptions,
  EvaluateBatchOptions,
  AnalyzeGameOptions,
  GameTurnAnalysis,
  EngineInfo,
  ModelInfo,
} from '../IAIEngine';
import { getWebRoot, toAbsoluteUrl } from '../../utils/web/pathUtils';
import { Game } from '../../../domain/game';
import { playerColorToSGFColor } from '../../../domain/primitives';
import { KataGoQueryBuilder } from '../../katago/KataGoQueryBuilder';

/** 默认 MCTS 访问数 */
const DEFAULT_ANALYZE_GAME_VISITS = 256;
/** 默认最大搜索时间 */
const DEFAULT_ANALYZE_GAME_MAX_TIME_MS = 800;

/**
 * KataGo Web 适配器
 * @description 在 Web 环境中使用 katago-core 的适配器实现
 */
export class KataGoWebAdapter implements IAIEngine {
  private client = getKataGoEngineClient();
  private currentModelFileName: string | null = null;
  /** 当前已加载的模型 URL（用于 analyze 调用） */
  private currentModelUrl: string | null = null;

  /**
   * 初始化引擎
   */
  async init(options: AIEngineInitOptions): Promise<void> {
    // 设置 Worker URL（懒加载，避免模块顶层访问 window）
    const workerUrl = toAbsoluteUrl('assets/worker.js');
    setWorkerUrl(workerUrl);
    
    const baseUrl = toAbsoluteUrl('');
    this.currentModelFileName = options.modelUrl.split('/').pop() ?? null;
    this.currentModelUrl = options.modelUrl;
    // 默认执行 warm up
    return this.client.init(options.modelUrl, options.onProgress, baseUrl, true);
  }

  /**
   * 分析棋局
   */
  async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
    return this.client.analyze({
      analysisGroup: options.analysisGroup,
      positionId: options.positionId,
      parentPositionId: options.parentPositionId,
      modelUrl: options.modelUrl,
      board: options.board,
      previousBoard: options.previousBoard,
      previousPreviousBoard: options.previousPreviousBoard,
      currentPlayer: options.currentPlayer,
      moveHistory: options.moveHistory,
      komi: options.komi,
      rules: options.rules,
      regionOfInterest: options.regionOfInterest,
      topK: options.topK,
      analysisPvLen: options.analysisPvLen,
      includeMovesOwnership: options.includeMovesOwnership,
      wideRootNoise: options.wideRootNoise,
      nnRandomize: options.nnRandomize,
      conservativePass: options.conservativePass,
      visits: options.visits,
      maxTimeMs: options.maxTimeMs,
      batchSize: options.batchSize,
      maxChildren: options.maxChildren,
      reportDuringSearchEveryMs: options.reportDuringSearchEveryMs,
      ownershipRefreshIntervalMs: options.ownershipRefreshIntervalMs,
      reuseTree: options.reuseTree,
      ownershipMode: options.ownershipMode,
      onProgress: options.onProgress,
    } as any);
  }

  /**
   * 整盘批量分析
   *
   * Web 端逐手串行调用 MCTS 搜索（通过 worker.js analyze），
   * 每手走完整的 MCTS 搜索，结果格式与 App 端原生 analyzeGame 兼容。
   *
   * 性能说明：
   * - App 端原生 analyzeGame 是一次请求 KataGo 进程批量搜索，性能最优
   * - Web 端逐手串行，每手一次 MCTS 搜索，但利用 reuseTree 加速相邻局面
   * - visits=1 时等价于快速评估（仅神经网络 + 1 次搜索）
   *
   * @param options 整盘分析选项
   * @returns 每个回合的分析结果
   */
  async analyzeGame(options: AnalyzeGameOptions): Promise<GameTurnAnalysis[]> {
    const komi = options.komi;
    const boardSize = options.boardXSize ?? options.boardYSize ?? 19;
    const rules = options.rules ?? 'chinese';
    const modelUrl = this.currentModelUrl ?? '';

    // 确定要分析的回合
    const totalMoves = options.moves.length;
    const turnsToAnalyze = options.analyzeTurns ?? Array.from({ length: totalMoves + 1 }, (_, i) => i);

    // MCTS 参数
    const visits = options.maxVisits ?? DEFAULT_ANALYZE_GAME_VISITS;
    const maxTimeMs = DEFAULT_ANALYZE_GAME_MAX_TIME_MS;
    const analysisPvLen = options.analysisPVLen ?? 15;
    const includeOwnership = options.includeOwnership ?? false;
    const includeMovesOwnership = options.includeMovesOwnership ?? false;
    const wideRootNoise = options.wideRootNoise;

    const results: GameTurnAnalysis[] = [];

    // 预构建所有着法（用于棋盘重建）
    const allMoves = options.moves;
    // 初始棋子（让子等）
    const initialStones = options.initialStones ?? [];

    for (let idx = 0; idx < turnsToAnalyze.length; idx++) {
      const turnIdx = turnsToAnalyze[idx]!;

      // 重建棋盘到 turnIdx 回合
      const { board, previousBoard, previousPreviousBoard, currentPlayer, moveHistory } =
        this.rebuildBoardState(allMoves, initialStones, turnIdx, boardSize);

      // 当前要分析的着法（用于 positionId / reuseTree）
      const positionId = `turn-${turnIdx}`;
      const parentPositionId = turnIdx > 0 ? `turn-${turnIdx - 1}` : undefined;

      const analysisResult = await this.client.analyze({
        modelUrl,
        board,
        previousBoard,
        previousPreviousBoard,
        currentPlayer,
        moveHistory,
        komi,
        rules: rules as any,
        visits,
        maxTimeMs,
        analysisPvLen,
        includeMovesOwnership,
        ownershipMode: includeOwnership ? 'root' : 'none',
        wideRootNoise,
        topK: 10,
        reuseTree: true,
        positionId,
        parentPositionId,
        // conservativePass 默认 true
      } as any);

      // 映射为 GameTurnAnalysis
      results.push(this.toGameTurnAnalysis(analysisResult, turnIdx, boardSize));

      // 进度回调
      options.onResultProgress?.(idx + 1, turnsToAnalyze.length);
    }

    return results;
  }

  /**
   * 评估棋局
   */
  async evaluate(options: EvaluateOptions) {
    return this.client.evaluate({
      modelUrl: options.modelUrl,
      board: options.board,
      previousBoard: options.previousBoard,
      previousPreviousBoard: options.previousPreviousBoard,
      currentPlayer: options.currentPlayer,
      moveHistory: options.moveHistory,
      komi: options.komi,
      rules: options.rules,
      conservativePass: options.conservativePass,
    } as any);
  }

  /**
   * 批量评估棋局
   */
  async evaluateBatch(options: EvaluateBatchOptions) {
    return this.client.evaluateBatch({
      modelUrl: options.modelUrl,
      positions: options.positions,
      rules: options.rules,
      conservativePass: options.conservativePass,
    } as any);
  }

  /**
   * 获取可用的模型列表（Web 端从本地 model-config.json 加载）
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const { getWebRoot } = await import('../../utils/web/pathUtils');
      const webRoot = getWebRoot();
      const response = await fetch(webRoot + 'models/model-config.json');
      if (response.ok) {
        const config = await response.json();
        const models = config.models || [];
        const currentName = this.currentModelFileName;
        return models.map((m: any) => {
          const modelFileName = m.url ? m.url.split('/').pop() : null;
          const isCurrent = !!(currentName && modelFileName && currentName === modelFileName);
          return {
            id: m.id,
            name: m.name,
            size: m.size || '',
            isDefault: !!m.default || !!m.isDefault,
            isCurrent,
            url: m.url || '',
          };
        });
      }
    } catch (e) {
      console.warn('[KataGoWebAdapter] Failed to load model config:', e);
    }
    return [];
  }

  /**
   * 获取引擎信息
   */
  getEngineInfo(): EngineInfo {
    return this.client.getEngineInfo();
  }

  // ─── Private helpers ──────────────────────────────────────────

  /**
   * 重建指定回合的棋盘状态
   *
   * 使用 Game 类正确处理围棋规则（提子、打劫等）。
   * 逻辑与 ReviewService.rebuildBoard 一致。
   *
   * @param moves 完整着法列表
   * @param initialStones 初始棋子（让子）
   * @param turnIndex 要重建的回合号（0=初始局面，1=第一手后...）
   * @param boardSize 棋盘大小
   * @returns 棋盘状态、前两步棋盘、当前玩家、着法历史
   */
  private rebuildBoardState(
    moves: Array<{ player: 'black' | 'white'; x: number; y: number }>,
    initialStones: Array<{ player: 'black' | 'white'; x: number; y: number }>,
    turnIndex: number,
    boardSize: number,
  ): {
    board: any[][];
    previousBoard: any[][] | undefined;
    previousPreviousBoard: any[][] | undefined;
    currentPlayer: 'black' | 'white';
    moveHistory: Array<{ x: number; y: number; player: 'black' | 'white' } | { pass: true; player: 'black' | 'white' }>;
  } {
    const game = new Game();
    game.newGame({ size: boardSize });

    // 放置初始棋子（让子）
    if (initialStones.length > 0) {
      const sgfStones = initialStones.map(s => ({
        x: s.x,
        y: s.y,
        color: playerColorToSGFColor(s.player),
      }));
      game.setHandicapStones(sgfStones);
    }

    // 依次落子到 turnIndex 回合
    const movesToPlay = moves.slice(0, turnIndex);
    for (const move of movesToPlay) {
      const isPass = move.x < 0 || move.y < 0;
      if (isPass) {
        game.pass();
        continue;
      }
      if (move.x >= 0 && move.x < boardSize && move.y >= 0 && move.y < boardSize) {
        game.placeStone(move.x, move.y);
      }
    }

    const board = game.getBoard().getState() as any[][];

    // 当前玩家：turnIndex 回合的落子方
    const currentPlayer = turnIndex < moves.length
      ? moves[turnIndex]!.player
      : (moves.length > 0
        ? (moves[moves.length - 1]!.player === 'black' ? 'white' : 'black')
        : (initialStones.length > 0 ? 'white' : 'black'));

    // 构建着法历史（worker analyze 需要的格式）
    const moveHistory = movesToPlay.map(m => {
      if (m.x < 0 || m.y < 0) return { pass: true, player: m.player } as any;
      return { x: m.x, y: m.y, player: m.player } as any;
    });

    // 重建 previousBoard 和 previousPreviousBoard
    let previousBoard: any[][] | undefined;
    let previousPreviousBoard: any[][] | undefined;

    if (turnIndex > 0) {
      const prevGame = new Game();
      prevGame.newGame({ size: boardSize });
      if (initialStones.length > 0) {
        prevGame.setHandicapStones(initialStones.map(s => ({
          x: s.x, y: s.y,
          color: playerColorToSGFColor(s.player),
        })));
      }
      for (const move of moves.slice(0, turnIndex - 1)) {
        if (move.x < 0 || move.y < 0) { prevGame.pass(); continue; }
        prevGame.placeStone(move.x, move.y);
      }
      previousBoard = prevGame.getBoard().getState() as any[][];
    }

    if (turnIndex > 1) {
      const prevPrevGame = new Game();
      prevPrevGame.newGame({ size: boardSize });
      if (initialStones.length > 0) {
        prevPrevGame.setHandicapStones(initialStones.map(s => ({
          x: s.x, y: s.y,
          color: playerColorToSGFColor(s.player),
        })));
      }
      for (const move of moves.slice(0, turnIndex - 2)) {
        if (move.x < 0 || move.y < 0) { prevPrevGame.pass(); continue; }
        prevPrevGame.placeStone(move.x, move.y);
      }
      previousPreviousBoard = prevPrevGame.getBoard().getState() as any[][];
    }

    return { board, previousBoard, previousPreviousBoard, currentPlayer, moveHistory };
  }

  /**
   * 将 worker AnalysisResult 映射为 GameTurnAnalysis
   *
   * worker 返回的 moves 使用 {x, y} 数字坐标，
   * GameTurnAnalysis.moveInfos.move 使用 GTP 字符串（如 "Q16"）。
   */
  private toGameTurnAnalysis(
    result: AnalysisResult,
    turnNumber: number,
    boardSize: number,
  ): GameTurnAnalysis {
    const moveInfos = (result.moves ?? []).map(m => {
      const moveStr = (m as any).x >= 0 && (m as any).y >= 0
        ? KataGoQueryBuilder.moveToGtp((m as any).x, (m as any).y, boardSize)
        : 'pass';

      return {
        move: moveStr,
        winrate: m.winRate,
        scoreLead: m.scoreLead,
        scoreMean: (m as any).scoreSelfplay ?? m.scoreLead,
        scoreStdev: (m as any).scoreStdev ?? 0,
        visits: m.visits,
        prior: (m as any).prior ?? 0,
        order: m.order,
        lcb: 0,
        utility: 0,
        pv: m.pv ?? [],
      };
    });

    return {
      turnNumber,
      rootWinRate: result.rootWinRate,
      rootScoreLead: result.rootScoreLead,
      rootVisits: (result as any).rootVisits ?? 0,
      moveInfos,
    };
  }
}

/**
 * 判断是否为取消错误
 */
export { KataGoCanceledError, isKataGoCanceledError } from '@weiqi/worker';

/**
 * 创建 KataGo Web 适配器实例
 */
export function createKataGoWebAdapter(): KataGoWebAdapter {
  return new KataGoWebAdapter();
}
