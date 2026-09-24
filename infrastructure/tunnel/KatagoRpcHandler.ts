/**
 * @fileoverview KataGo RPC 处理器
 * @description 服务端处理器：接收 KataGo RPC 请求，调用本地 IAIEngine 执行
 *
 * 支持的 RPC 方法：
 * - init: 初始化引擎
 * - analyze: 单局面分析
 * - analyzeGame: 整盘批量分析（原生优先，Web 端 fallback 逐手串行）
 * - evaluate: 评估
 * - evaluateBatch: 批量评估
 * - getEngineInfo: 获取引擎信息
 */

import type { IAIEngine, AIEngineInitOptions, AnalyzeOptions, AnalyzeGameOptions, EvaluateOptions, EvaluateBatchOptions, ModelInfo, GameTurnAnalysis } from '../ai/IAIEngine';
import type { IRpcHandler, TunnelService } from './types';

/** KataGo RPC 请求参数映射 */
interface KatagoRpcParams {
  init: AIEngineInitOptions;
  analyze: AnalyzeOptions;
  analyzeGame: AnalyzeGameOptions;
  evaluate: EvaluateOptions;
  evaluateBatch: EvaluateBatchOptions;
  getEngineInfo: void;
  listModels: void;
}

/** KataGo RPC 方法名 */
type KatagoMethod = keyof KatagoRpcParams;

export class KatagoRpcHandler implements IRpcHandler {
  readonly serviceName: TunnelService = 'katago';
  private engine: IAIEngine;


  constructor(engine: IAIEngine) {
    this.engine = engine;
  }

  /** 更新引擎实例（切换模型时） */
  setEngine(engine: IAIEngine): void {
    this.engine = engine;
  }

  async handle(method: string, params: unknown, onProgress?: (data: unknown) => void): Promise<unknown> {
    const m = method as KatagoMethod;
    switch (m) {
      case 'init': {
        const initOpts = params as AIEngineInitOptions;
        if (onProgress) {
          initOpts.onProgress = (loaded, total, progress) => {
            onProgress({ type: 'download', loaded, total, progress });
          };
          initOpts.onInitProgress = (info) => {
            onProgress({ type: 'init', ...info });
          };
        }
        return this.engine.init(initOpts);
      }

      case 'analyze':
        return this.engine.analyze(params as AnalyzeOptions);

      case 'analyzeGame': {
        const opts = params as AnalyzeGameOptions;
        // 转发进度回调
        const optsWithProgress: AnalyzeGameOptions = {
          ...opts,
          onResultProgress: (current: number, total: number) => {
            onProgress?.({ current, total });
          },
        };
        // 原生引擎支持 analyzeGame（批量 MCTS，性能最优）
        if (this.engine.analyzeGame) {
          const result = await this.engine.analyzeGame(optsWithProgress);
          if (!result) throw new Error('analyzeGame 返回空结果');
          return result;
        }
        // Fallback：Web 端无 analyzeGame，逐手串行 analyze 模拟
        return this.analyzeGameFallback(opts, onProgress);
      }

      case 'evaluate':
        return this.engine.evaluate(params as EvaluateOptions);

      case 'evaluateBatch':
        return this.engine.evaluateBatch(params as EvaluateBatchOptions);

      case 'getEngineInfo':
        return this.engine.getEngineInfo();

      case 'listModels': {
        const models = await this.engine.listModels?.() ?? [];
        // 从 localStorage 读取服务端当前选中的模型和自定义模型 URL
        // LocalStorageAdapter 用 JSON.stringify 存储，需要 JSON.parse
        const readLS = (key: string): string | null => {
          const raw = localStorage.getItem(`weiqi-model:${key}`);
          if (!raw) return null;
          try { return JSON.parse(raw) as string; } catch { return raw; }
        };
        const currentModelId = readLS('current-model');
        const currentFileName = readLS('current-model-filename');
        const customUrl = readLS('custom-model-url');

        // 如果有自定义模型 URL，追加到列表
        if (customUrl && !models.some(m => m.id === 'custom')) {
          const filename = customUrl.split('/').pop() || 'custom';
          models.push({
            id: 'custom',
            name: `自定义模型 (${filename})`,
            size: '',
            isDefault: false,
            url: customUrl,
          });
        }

        // 标记当前选中的模型
        if (currentModelId) {
          for (const m of models) {
            if (m.id === currentModelId) {
              m.isCurrent = true;
            } else if (currentFileName) {
              const fileName = m.url?.split('/').pop() ?? ``;
              if (fileName && fileName === currentFileName) {
                m.isCurrent = true;
              }
            }
          }
        }
        return models;
      }

      default:
        throw new Error(`未知的 KataGo 方法: ${method}`);
    }
  }

  /**
   * analyzeGame Fallback：逐手串行 analyze（Web 端无原生 analyzeGame 时使用）
   *
   * 性能远不如原生批量分析，但功能等价：
   * 对每个 analyzeTurns 指定的回合，重建棋盘 → 调 analyze → 映射为 GameTurnAnalysis
   */
  private async analyzeGameFallback(opts: AnalyzeGameOptions, onProgress?: (data: unknown) => void): Promise<GameTurnAnalysis[]> {
    const moves = opts.moves;
    const boardSize = opts.boardXSize ?? 19;
    const komi = opts.komi;
    const rules = opts.rules;
    const initialStones = opts.initialStones;
    const visits = opts.maxVisits;
    const analysisPVLen = opts.analysisPVLen;
    const topK = 5; // 默认取前5候选
    const includeOwnership = opts.includeOwnership ?? false;

    // 确定要分析的回合列表
    const turns = opts.analyzeTurns ?? Array.from({ length: moves.length }, (_, i) => i);
    const total = turns.length;
    const results: GameTurnAnalysis[] = [];

    // 逐手分析
    for (let idx = 0; idx < total; idx++) {
      const turn = turns[idx]!;
      // 重建到第 turn 手之前的棋盘
      const board = this.rebuildBoard(moves, turn, boardSize, initialStones);
      const previousBoard = turn > 0 ? this.rebuildBoard(moves, turn - 1, boardSize, initialStones) : undefined;
      const move = moves[turn];
      const currentPlayer = move ? move.player : 'black';
      const moveHistory = moves.slice(0, turn).map(m => ({ x: m.x, y: m.y, player: m.player }));

      const analyzeOpts: AnalyzeOptions = {
        modelUrl: '', // Web 端 init 后模型已加载，modelUrl 不再需要
        board,
        previousBoard,
        currentPlayer,
        moveHistory,
        komi,
        rules: rules as any,
        topK,
        analysisPvLen: analysisPVLen,
        includeMovesOwnership: includeOwnership,
        visits,
        ...(initialStones ? { initialStones } : {}),
        boardXSize: boardSize,
        boardYSize: boardSize,
      };

      const analysis = await this.engine.analyze(analyzeOpts);

      // 映射 AnalysisResult → GameTurnAnalysis
      // moveInfos 可能为 undefined（Web Worker 返回 moves 而非 moveInfos）
      const rawMoveInfos = analysis.moveInfos;
      const turnAnalysis: GameTurnAnalysis = {
        turnNumber: turn,
        rootWinRate: analysis.rootWinRate,
        rootScoreLead: analysis.rootScoreLead,
        rootVisits: rawMoveInfos?.[0]?.visits ?? 0,
        moveInfos: (rawMoveInfos ?? []).map(mi => ({
          move: mi.move,
          winrate: mi.winrate,
          scoreLead: mi.scoreLead,
          scoreMean: mi.scoreMean,
          scoreStdev: mi.scoreStdev,
          visits: mi.visits,
          prior: mi.prior,
          order: 0, // Web Worker 不返回 order，默认 0
          lcb: 0,   // Web Worker 不返回 lcb，默认 0
          utility: 0, // Web Worker 不返回 utility，默认 0
          pv: mi.pv,
        })),
      };
      results.push(turnAnalysis);

      onProgress?.({ current: idx + 1, total });
    }

    return results;
  }

  /** 重建棋盘状态（到第 upto 手之前） */
  private rebuildBoard(
    moves: Array<{ player: string; x: number; y: number }>,
    upto: number,
    size: number,
    initialStones?: Array<{ player: string; x: number; y: number }>,
  ): any[][] {
    const board: any[][] = Array.from({ length: size }, () => new Array(size).fill(0));
    // 放置初始棋子（让子等）
    if (initialStones) {
      for (const s of initialStones) {
        if (s.x >= 0 && s.y >= 0 && s.x < size && s.y < size) {
          board[s.y]![s.x] = s.player === 'black' ? 1 : 2;
        }
      }
    }
    // 逐手落子（简化：不处理提子，KataGo 会根据 moveHistory 自行修正）
    for (let i = 0; i < upto && i < moves.length; i++) {
      const m = moves[i]!;
      if (m.x < 0 || m.y < 0) continue; // pass
      if (m.x >= size || m.y >= size) continue;
      board[m.y]![m.x] = m.player === 'black' ? 1 : 2;
    }
    return board;
  }
}
