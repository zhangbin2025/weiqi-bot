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
      const isBlunderProblem = this.checkBlunder(deduped, practicalMove);
      
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

      const problem = this.buildProblem(deduped, moveNum, moves, gameInfo, gameLevel, gameId, practicalMove, options);
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
    return Array.from(seen.values());
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

  /** 检测恶手：实战胜率与最高胜率差 > 20%，对齐 weiqi-move/scripts/quiz.py */
  private checkBlunder(vars: VarWithRate[], practical?: VariationMove): boolean {
    if (!practical || !vars.length) return false;
    const maxRate = Math.max(...vars.map(v => v.winrate));
    const pv = vars.find(v => v.firstMove.coord === practical.coord);
    return pv ? maxRate - pv.winrate > 20 : false;
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
    genOptions?: DecisionGenerateOptions
  ): IDecisionProblem | null {
    if (vars.length < 2) return null;

    const sorted = [...vars].sort((a, b) => b.winrate - a.winrate);
    const labels: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const decisionOptions: IDecisionOption[] = sorted.slice(0, 4).map((v, i) => ({
      position: v.firstMove.coord,
      winrate: v.winrate,
      label: labels[i]!,
      variations: v.variation.moves.slice(1, 10).map(m => m.coord),
      isPractical: practicalMove ? v.firstMove.coord === practicalMove.coord : false, // 标识实战选点
    }));

    const best = sorted[0]!.winrate;
    const second = sorted[1]?.winrate ?? 0;
    const isBlunderProblem = this.checkBlunder(vars, practicalMove);
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
