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
    const gameLevel = determineGameLevel(gameInfo.blackRank, gameInfo.whiteRank);
    const gameId = gameInfo.gameName || 'unknown';
    const problems: IDecisionProblem[] = [];
    const maxCount = options?.maxCount;
    const blunderOnly = options?.blunderOnly ?? false;

    for (const [moveNumStr, vars] of Object.entries(variations)) {
      const moveNum = parseInt(moveNumStr, 10);
      if (vars.length < 2) continue;

      const deduped = this.dedupVariations(vars);
      if (deduped.length < 2) continue;

      const practicalMove = moves[moveNum];
      const isBlunderProblem = this.checkBlunder(deduped, practicalMove, moveNum, moves, variations);
      
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

      const problem = this.buildProblem(deduped, moveNum, moves, gameInfo, gameLevel, gameId, practicalMove, options, variations);
      if (problem) problems.push(problem);
    }

    // 排序：恶手题优先，按手数排序
    if (options?.blunderFirst ?? true) {
      problems.sort((a, b) => {
        const aB = a.difficulty === 'blunder' ? 0 : 1;
        const bB = b.difficulty === 'blunder' ? 0 : 1;
        return aB !== bB ? aB - bB : a.metadata.moveNumber - b.metadata.moveNumber;
      });
    }

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

  /** 从下一手变化图推算实战胜率
   *  白棋下完后的胜率 = 100% - 下一手对方变化图最高胜率
   *  黑棋下完后的胜率 = 100% - 下一手对方变化图最高胜率
   */
  private getPracticalWinrate(
    moveNum: number,
    moves: VariationMove[],
    allVariations: Record<string, ISGFVariation[]>,
  ): number | undefined {
    // 下一手 = moveNum + 1
    const nextVars = allVariations[String(moveNum + 1)];
    if (!nextVars || nextVars.length === 0) return undefined;

    // 提取下一手所有变化图的胜率，取最高
    let nextMaxRate = 0;
    for (const v of nextVars) {
      if (!v.moves?.length) continue;
      const rate = this.extractRate(v.comment);
      if (rate > nextMaxRate) nextMaxRate = rate;
    }
    if (nextMaxRate === 0) return undefined;

    // 实战胜率 = 100% - 下一手对方最高胜率
    return 100 - nextMaxRate;
  }

  /** 检测恶手：实战胜率与最高胜率差 > 20%，对齐 weiqi-move/scripts/quiz.py
   *  当实战选点不在 AI 变化图中时，通过下一手变化图推算实战胜率
   */
  private checkBlunder(
    vars: VarWithRate[],
    practical: VariationMove | undefined,
    moveNum: number,
    moves: VariationMove[],
    allVariations: Record<string, ISGFVariation[]>,
  ): boolean {
    if (!practical || !vars.length) return false;
    const maxRate = Math.max(...vars.map(v => v.winrate));
    const pv = vars.find(v => v.firstMove.coord === practical.coord);

    if (pv) {
      // 实战选点在变化图中，直接比较
      return maxRate - pv.winrate > 20;
    }

    // 实战选点不在变化图中，通过下一手推算实战胜率
    const practicalRate = this.getPracticalWinrate(moveNum, moves, allVariations);
    if (practicalRate === undefined) return false;

    return maxRate - practicalRate > 20;
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
    },
    gameLevel: string,
    gameId: string,
    practicalMove?: VariationMove,
    genOptions?: DecisionGenerateOptions,
    allVariations?: Record<string, ISGFVariation[]>,
  ): IDecisionProblem | null {
    if (vars.length < 2) return null;

    const sorted = [...vars].sort((a, b) => b.winrate - a.winrate);
    const rankLabels = ['一选', '二选', '三选', '四选'];
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
      // 实战选点在变化图中，或没有实战信息 → 正常取 top 4
      decisionOptions = sorted.slice(0, 4).map((v, i) => {
        const isThisPractical = practicalMove ? v.firstMove.coord === practicalMove.coord : false;
        // 实战选点在变化图中但无胜率注释时，用下一手推算
        const winrate = (isThisPractical && v.winrate === 0 && inferredPracticalRate !== undefined)
          ? inferredPracticalRate
          : v.winrate;
        return {
          position: v.firstMove.coord,
          winrate,
          label: isThisPractical && practicalRank > 0 ? `实战（${rankLabels[practicalRank - 1]}）` : rankLabels[i]!,
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
            opt.label = `实战（${rankLabels[i]}）`;
          } else {
            opt.label = rankLabels[i]!;
          }
        }
      }
    } else {
      // 实战选点不在 AI 变化图中 → 需要把实战选点作为选项加入
      const practicalRate = this.getPracticalWinrate(moveNum, moves, allVarsMap);
      // 实战后续着法（从SGF棋谱中取最多10手）
      const gameContinuation = moves.slice(moveNum + 1, moveNum + 11).map(m => m.coord);

      // 取 top 3 AI 选项
      const aiOptions: IDecisionOption[] = sorted.slice(0, 3).map((v, i) => ({
        position: v.firstMove.coord,
        winrate: v.winrate,
        label: rankLabels[i]!,
        variations: v.variation.moves.slice(1, 10).map(m => m.coord),
        isPractical: false,
      }));

      const practicalOption: IDecisionOption = {
        position: practicalMove.coord,
        winrate: practicalRate ?? 0,
        label: '实战',
        variations: gameContinuation,
        isPractical: true,
      };

      decisionOptions = [...aiOptions, practicalOption];

      // 按胜率重新排序，重新分配标签
      decisionOptions.sort((a, b) => b.winrate - a.winrate);
      for (let i = 0; i < decisionOptions.length; i++) {
        const opt = decisionOptions[i]!;
        if (opt.isPractical) {
          // 实战不在AI推荐中，标注实际排第几选
          const rank = i + 1;
          opt.label = '实战';
        } else {
          opt.label = rankLabels[i]!;
        }
      }
    }

    const best = decisionOptions[0]!.winrate;
    const second = decisionOptions[1]?.winrate ?? 0;
    const isBlunderProblem = this.checkBlunder(sorted, practicalMove, moveNum, moves, allVarsMap);
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
      },
    };
  }
}
