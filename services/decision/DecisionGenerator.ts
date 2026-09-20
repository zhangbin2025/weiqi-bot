/**
 * 决策题目生成器
 * @module services/decision/DecisionGenerator
 */

import { parseSGF } from '../../domain/sgf';
import { calcDifficulty, classifyPhase, determineGameLevel, generateProblemId } from '../../domain/decision';
import type { IDecisionProblem, IDecisionOption } from '../../domain/decision';
import type { DecisionGenerateOptions } from './types';
import type { ISGFVariation, VariationMove } from '../../domain/sgf';

/** 带胜率的变化图 */
interface VarWithRate {
  variation: ISGFVariation;
  winrate: number;
  firstMove: VariationMove;
}

/**
 * 决策题目生成器 - 核心逻辑编排 Domain 层
 */
export class DecisionGenerator {
  /** 从SGF解析结果生成决策题 */
  generate(sgf: string, options?: DecisionGenerateOptions): IDecisionProblem[] {
    const result = parseSGF(sgf);
    const { gameInfo, moves, variations } = result;

    // OGS 的 SGF 胜率是黑方胜率，需转为当前方胜率（与野狐/KataGo 对齐）
    // 转换后所有下游逻辑（checkBlunder/getPracticalWinrate/buildProblem）统一用当前方胜率
    const isBlackWinrate = options?.source === 'ogs';
    const convertedVariations = isBlackWinrate
      ? this.convertBlackWinrates(variations, moves)
      : variations;

    // 恶手判定阈值（百分比），默认 20%；可用 blunderThreshold 覆盖基准值
    const baseThreshold = options?.blunderThreshold ?? 20;
    // 回退序列：从基准阈值开始，无恶手题则依次回退到 15%、10%
    const thresholds = options?.blunderThresholds
      ?? [...new Set([baseThreshold, 15, 10].filter(t => t <= baseThreshold))];

    const blunderOnly = options?.blunderOnly ?? false;

    // 只生成恶手题时：逐个阈值尝试，采用第一个能产出恶手题的阈值
    if (blunderOnly) {
      for (const threshold of thresholds) {
        const problems = this.collectProblems(convertedVariations, moves, gameInfo, options, threshold);
        if (problems.some(p => p.difficulty === 'blunder')) {
          return this.finalize(problems, options);
        }
      }
      return []; // 所有阈值均无恶手题
    }

    // 非恶手题模式：单次生成，用基准阈值判定
    const problems = this.collectProblems(convertedVariations, moves, gameInfo, options, thresholds[0]!);
    return this.finalize(problems, options);
  }

  /** 按给定恶手阈值遍历每一手，收集题目 */
  private collectProblems(
    convertedVariations: Record<number, ISGFVariation[]>,
    moves: VariationMove[],
    gameInfo: ReturnType<typeof parseSGF>['gameInfo'],
    options: DecisionGenerateOptions | undefined,
    blunderThreshold: number,
  ): IDecisionProblem[] {
    const gameLevel = determineGameLevel(gameInfo.blackRank, gameInfo.whiteRank);
    const gameId = gameInfo.gameName || 'unknown';
    const problems: IDecisionProblem[] = [];
    const blunderOnly = options?.blunderOnly ?? false;

    for (const [moveNumStr, vars] of Object.entries(convertedVariations)) {
      const moveNum = parseInt(moveNumStr, 10);
      if (vars.length < 2) continue;

      const deduped = this.dedupVariations(vars);
      if (deduped.length < 2) continue;

      const practicalMove = moves[moveNum];
      const isBlunderProblem = this.checkBlunder(deduped, practicalMove, moveNum, moves, convertedVariations, blunderThreshold);

      // 如果设置只生成恶手题，且不是恶手，跳过
      if (blunderOnly && !isBlunderProblem) continue;

      // 难度筛选
      if (options?.difficulty) {
        const sorted = [...deduped].sort((a, b) => b.winrate - a.winrate);
        const diff = isBlunderProblem ? 'blunder' : calcDifficulty(sorted[0]!.winrate, sorted[1]?.winrate ?? 0);
        if (diff !== options.difficulty) continue;
      }
      // 阶段筛选
      if (options?.phase && classifyPhase(moveNum) !== options.phase) continue;

      const problem = this.buildProblem(deduped, moveNum, moves, gameInfo, gameLevel, gameId, practicalMove, options, convertedVariations, gameInfo.boardSize, blunderThreshold);
      if (problem) problems.push(problem);
    }

    return problems;
  }

  /** 排序（恶手题优先）并按 maxCount 截断 */
  private finalize(problems: IDecisionProblem[], options?: DecisionGenerateOptions): IDecisionProblem[] {
    if (options?.blunderFirst ?? true) {
      problems.sort((a, b) => {
        const aB = a.difficulty === 'blunder' ? 0 : 1;
        const bB = b.difficulty === 'blunder' ? 0 : 1;
        return aB !== bB ? aB - bB : a.metadata.moveNumber - b.metadata.moveNumber;
      });
    }
    const maxCount = options?.maxCount;
    return maxCount ? problems.slice(0, maxCount) : problems;
  }

  /** 去重：第一步相同的变化只保留胜率最高的 */
  private dedupVariations(vars: ISGFVariation[]): VarWithRate[] {
    const seen = new Map<string, VarWithRate>();
    for (const v of vars) {
      if (!v.moves?.length) continue;
      const first = v.moves[0]!;
      const rate = this.extractRate(v.comment);
      const exist = seen.get(first.coord);
      if (!exist || rate > exist.winrate) seen.set(first.coord, { variation: v, winrate: rate, firstMove: first });
    }
    return Array.of(...seen.values());
  }

  /** 从注释提取胜率（对齐 weiqi-move/scripts/quiz.py 的优先级） */
  private extractRate(comment?: string): number {
    if (!comment) return 0;
    const cn = comment.match(/[黑白].*?(\d+\.?\d*)%/);
    if (cn) return parseFloat(cn[1]!);
    const bw = comment.match(/[BW]\s+(\d+\.?\d*)%/);
    if (bw) return parseFloat(bw[1]!);
    const generic = comment.match(/(\d+\.?\d*)%/);
    return generic ? parseFloat(generic[1]!) : 0;
  }

  /** 从下一手变化图推算实战胜率（当前方胜率）
   *  胜率统一为当前方胜率，下一手是对方选择，取对方最高胜率后翻转
   */
  private getPracticalWinrate(
    moveNum: number,
    moves: VariationMove[],
    allVariations: Record<string, ISGFVariation[]>,
    vars?: VarWithRate[],
  ): number | undefined {
    // 优先：从下一手 AI 推荐分支推算（野狐每手都有推荐分支）
    const nextVars = allVariations[String(moveNum + 1)];
    if (nextVars && nextVars.length > 0) {
      let nextMaxRate = 0;
      for (const v of nextVars) {
        if (!v.moves?.length) continue;
        const rate = this.extractRate(v.comment);
        if (rate > nextMaxRate) nextMaxRate = rate;
      }
      if (nextMaxRate > 0) {
        return 100 - nextMaxRate;
      }
    }

    // 回退：没有下一手推荐分支时，取当前手推荐选点中最差的胜率
    // 表示实战胜率比最差推荐还差，用 < 号标记
    if (vars && vars.length > 0) {
      return Math.min(...vars.map(v => v.winrate));
    }

    return undefined;
  }

  /** 检测恶手：实战胜率与最高胜率差 > blunderThreshold（默认 20%)
   *  胜率统一为当前方胜率（SGF 生成时已转换），无需区分黑白
   */
  private checkBlunder(
    vars: VarWithRate[],
    practical: VariationMove | undefined,
    moveNum: number,
    moves: VariationMove[],
    allVariations: Record<string, ISGFVariation[]>,
    blunderThreshold = 20,
  ): boolean {
    if (!practical || !vars.length) return false;
    const maxRate = Math.max(...vars.map(v => v.winrate));
    const pv = vars.find(v => v.firstMove.coord === practical.coord);

    if (pv) {
      return maxRate - pv.winrate > blunderThreshold;
    }

    const practicalRate = this.getPracticalWinrate(moveNum, moves, allVariations, vars);
    if (practicalRate === undefined) return false;

    return maxRate - practicalRate > blunderThreshold;
  }

  /** 构造题目 */
  private buildProblem(
    vars: VarWithRate[],
    moveNum: number,
    moves: VariationMove[],
    gameInfo: {
      black: string;
      white: string;
      blackRank?: string;
      whiteRank?: string;
      gameName?: string;
      event?: string;
      date?: string;
      result?: string;
      boardSize?: number;
    },
    gameLevel: string,
    gameId: string,
    practicalMove?: VariationMove,
    genOptions?: DecisionGenerateOptions,
    allVariations?: Record<string, ISGFVariation[]>,
    boardSize?: number,
    blunderThreshold = 20,
  ): IDecisionProblem | null {
    if (vars.length < 2) return null;

    const sorted = [...vars].sort((a, b) => b.winrate - a.winrate);
    const rankLabels = ['一选', '二选', '三选', '四选'];
    /**
     * 安全取选点标签：rankLabels 只有 4 个条目，实战选点排第 5 名及以后会越界得到 undefined。
     * 越界时回退为「第N选」，避免界面出现「实战（undefined）」。
     */
    const safeRankLabel = (rank: number): string => rankLabels[rank - 1] ?? `第${rank}选`;
    const allVarsMap = allVariations ?? {};

    // 检查实战选点是否在 AI 变化图中
    const practicalInVars = practicalMove
      ? sorted.some(v => v.firstMove.coord === practicalMove.coord)
      : false;

    let decisionOptions: IDecisionOption[];

    // 记录实战命中几选
    let practicalRank = 0;
    if (practicalMove) {
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i]!.firstMove.coord === practicalMove.coord) {
          practicalRank = i + 1;
          break;
        }
      }
    }

    // 推算实战胜率（用于变化图中有实战选点但无胜率注释的情况）
    const inferredPracticalRate = (practicalMove && practicalInVars)
      ? this.getPracticalWinrate(moveNum, moves, allVarsMap)
      : undefined;

    if (practicalInVars || !practicalMove) {
      // 实战选点在变化图中，或没有实战信息 → 取 top 4，但确保实战包含在内
      let topPicks = sorted.slice(0, 4);
      // 如果实战在变化图中但不在 top 4，替换最后一个
      if (practicalMove && practicalRank > 4) {
        topPicks = [...sorted.slice(0, 3), sorted[practicalRank - 1]!];
      }
      decisionOptions = topPicks.map((v, i) => {
        const isThisPractical = practicalMove ? v.firstMove.coord === practicalMove.coord : false;
        // 实战选点在变化图中但无胜率注释时，用下一手推算
        const winrate = (isThisPractical && v.winrate === 0 && inferredPracticalRate !== undefined)
          ? inferredPracticalRate
          : v.winrate;
        return {
          position: v.firstMove.coord,
          winrate,
          label: isThisPractical && practicalRank > 0 ? `实战（${safeRankLabel(practicalRank)}）` : safeRankLabel(i + 1),
          variations: v.variation.moves.slice(1, 10).map(m => m.coord),
          isPractical: isThisPractical,
        };
      });

      // 如果实战选点胜率被推算修正，需要重新排序和分配标签
      if (inferredPracticalRate !== undefined && inferredPracticalRate > 0) {
        decisionOptions.sort((a, b) => b.winrate - a.winrate);
        for (let i = 0; i < decisionOptions.length; i++) {
          const opt = decisionOptions[i]!;
          if (opt.isPractical) {
            practicalRank = i + 1;
            opt.label = `实战（${safeRankLabel(i + 1)}）`;
          } else {
            opt.label = safeRankLabel(i + 1);
          }
        }
      }
    } else {
      // 实战选点不在 AI 变化图中 → 需要把实战选点作为选项加入
      // 判断是否有下一手推荐分支（决定胜率是否为近似值）
      const nextVarsForCheck = allVarsMap[String(moveNum + 1)];
      const nextVarsHasBranches = nextVarsForCheck && nextVarsForCheck.length > 0;
      const practicalRate = this.getPracticalWinrate(moveNum, moves, allVarsMap, sorted);
      // 实战后续着法（从SGF棋谱中取最多10手）
      const gameContinuation = moves.slice(moveNum + 1, moveNum + 11).map(m => m.coord);

      // 取 top 3 AI 选项
      const aiOptions: IDecisionOption[] = sorted.slice(0, 3).map((v, i) => ({
        position: v.firstMove.coord,
        winrate: v.winrate,
        label: safeRankLabel(i + 1),
        variations: v.variation.moves.slice(1, 10).map(m => m.coord),
        isPractical: false,
      }));

      // practicalRate 来自最差推荐选点回退时，标记为近似值（显示 < 号）
      const isApproximate = !nextVarsHasBranches;
      const practicalOption: IDecisionOption = {
        position: practicalMove.coord,
        winrate: practicalRate ?? 0,
        label: '实战',
        variations: gameContinuation,
        isPractical: true,
        winrateApproximate: isApproximate,
      };

      decisionOptions = [...aiOptions, practicalOption];

      // 按对当前方的优劣重新排序
      decisionOptions.sort((a, b) => b.winrate - a.winrate);
      for (let i = 0; i < decisionOptions.length; i++) {
        const opt = decisionOptions[i]!;
        if (opt.isPractical) {
          // 实战不在AI推荐中，标注实际排第几选
          const rank = i + 1;
          opt.label = '实战';
        } else {
          opt.label = safeRankLabel(i + 1);
        }
      }
    }

    const best = decisionOptions[0]!.winrate;
    const second = decisionOptions[1]?.winrate ?? 0;
    const isBlunderProblem = this.checkBlunder(sorted, practicalMove, moveNum, moves, allVarsMap, blunderThreshold);
    // calcDifficulty expects best > second (both from current player's perspective)
    // For white moves, we already sorted ascending, so best < second in black winrate terms
    // Need to pass values where best is the best for current player
    const difficulty = isBlunderProblem ? 'blunder' : calcDifficulty(best, second);

    return {
      id: generateProblemId(gameId, moveNum),
      position: moves.slice(0, moveNum).map(m => `${m.color}${m.coord}`).join(''),
      turn: moveNum % 2 === 0 ? 'B' : 'W',
      options: decisionOptions,
      correctIndex: 0, // 恶手题中：AI选点是正确答案（胜率最高），实战选点是恶手（isPractical=true）
      difficulty,
      phase: classifyPhase(moveNum),
      metadata: {
        moveNumber: moveNum,
        playerBlack: gameInfo.black,
        playerWhite: gameInfo.white,
        blackRank: gameInfo.blackRank,
        whiteRank: gameInfo.whiteRank,
        gameLevel: gameLevel as 'pro' | 'high' | 'normal',
        gameName: gameInfo.gameName,
        event: gameInfo.event,
        date: gameInfo.date,
        result: gameInfo.result,
        archiveId: genOptions?.archiveId,
        url: genOptions?.url,
        gameId,
        boardSize: boardSize ?? gameInfo.boardSize ?? 19,
      },
    };
  }

  /**
   * 将 OGS 黑方胜率转换为当前方胜率
   *
   * OGS 的 SGF 注释中胜率始终是黑方胜率（如 "胜率: 55.3%" 或 "选点1: 胜率=62.1%"）。
   * 此方法重建 variations，将白棋着手的胜率注释翻转为白方胜率。
   *
   * @param variations - 原始 variations（胜率为黑方胜率）
   * @param moves - 棋谱着法（含 color 信息）
   * @returns 转换后的 variations（胜率为当前方胜率）
   */
  private convertBlackWinrates(
    variations: Record<number, ISGFVariation[]>,
    moves: { color: string; coord: string }[]
  ): Record<number, ISGFVariation[]> {
    const result: Record<number, ISGFVariation[]> = {};

    for (const [moveNumStr, vars] of Object.entries(variations)) {
      const moveNum = parseInt(moveNumStr, 10);
      const currentColor = moves[moveNum]?.color;
      const isWhite = currentColor === 'W';

      result[moveNum] = vars.map(v => {
        if (!v.comment) return v;
        // 转换注释中的胜率：白棋时 100 - 黑方胜率
        const convertedComment = isWhite
          ? v.comment.replace(/(\d+\.?\d*)%/g, (match, num) => {
              const wr = parseFloat(num);
              return `${(100 - wr).toFixed(1)}%`;
            })
          : v.comment;
        return { ...v, comment: convertedComment };
      });
    }

    return result;
  }
}
