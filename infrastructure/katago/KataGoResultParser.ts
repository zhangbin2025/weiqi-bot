/**
 * @fileoverview KataGo 原生响应解析器
 * @description 将 KataGo analysis 协议的 JSON 响应转换为 TS 层统一类型
 */

import type { GameTurnAnalysis } from '../ai/IAIEngine';
import { KataGoQueryBuilder } from './KataGoQueryBuilder';

/**
 * KataGo 原生 moveInfo 格式
 * 
 * 注意：KataGo 可能返回两种格式的字段名：
 * 1. 标准格式：visits, winrate, scoreLead, scoreMean 等
 * 2. 简化格式：edgeVisits, edgeWeight, playSelectionValue 等
 */
interface KataGoMoveInfo {
  move: string;
  // 标准格式字段
  winrate?: number;
  scoreLead?: number;
  scoreMean?: number;
  scoreStdev?: number;
  visits?: number;
  // 简化格式字段（KataGo 某些版本返回）
  edgeVisits?: number;
  edgeWeight?: number;
  playSelectionValue?: number;
  // 公共字段
  prior: number;
  order: number;
  lcb: number;
  utility?: number;
  pv: string[];
  pvVisits?: number[];
  ownership?: number[];
}

/**
 * KataGo 原生 rootInfo 格式
 */
interface KataGoRootInfo {
  winrate: number;
  scoreLead: number;
  scoreMean: number;
  scoreStdev: number;
  utility: number;
  visits: number;
}

/**
 * KataGo 原生响应格式
 */
interface KataGoAnalysisResponse {
  id: string;
  isDuringSearch?: boolean;
  turnNumber?: number;
  rootInfo?: KataGoRootInfo;
  moveInfos?: KataGoMoveInfo[];
  ownership?: number[];
  ownershipStdev?: number[];
  error?: string;
  warning?: string;
}

/**
 * KataGo 结果解析器
 *
 * 解析 KataGo analysis 协议的 stdout JSON 行，
 * 转换为 TS 层的 GameTurnAnalysis 类型。
 */
export class KataGoResultParser {

  /**
   * 解析整盘分析结果（多行，每行一个 turn）
   */
  static parseGameAnalysis(rawResults: string[]): GameTurnAnalysis[] {
    const turns = rawResults
      .map(raw => this.parseTurnResult(raw))
      .filter((t): t is GameTurnAnalysis => t !== null);

    turns.sort((a, b) => a.turnNumber - b.turnNumber);
    return turns;
  }

  /**
   * 解析单条结果
   */
  static parseTurnResult(rawJson: string): GameTurnAnalysis | null {
    try {
      const obj: KataGoAnalysisResponse = JSON.parse(rawJson);

      if (obj.error) {
        console.error('[KataGoResultParser] Error in response:', obj.error);
        return null;
      }

      if (obj.isDuringSearch) return null;

      const rootInfo = obj.rootInfo ?? { winrate: 0, scoreLead: 0, scoreMean: 0, scoreStdev: 0, utility: 0, visits: 0 };

      const result: GameTurnAnalysis = {
        turnNumber: obj.turnNumber ?? 0,
        rootWinRate: rootInfo.winrate,
        rootScoreLead: rootInfo.scoreLead,
        rootVisits: rootInfo.visits,
        moveInfos: (obj.moveInfos ?? []).map(mi => ({
          move: mi.move,
          // 适配两种格式：标准格式和简化格式
          winrate: mi.winrate ?? 0,
          scoreLead: mi.scoreLead ?? 0,
          scoreMean: mi.scoreMean ?? 0,
          scoreStdev: mi.scoreStdev ?? 0,
          // visits 可能是标准字段，也可能是 edgeVisits
          visits: mi.visits ?? mi.edgeVisits ?? 0,
          prior: mi.prior,
          order: mi.order,
          lcb: mi.lcb,
          utility: mi.utility ?? 0,
          pv: mi.pv ?? [],
          ...(mi.pvVisits != null ? { pvVisits: mi.pvVisits } : {}),
        })),
      };

      // 只在有值时设置 ownership（避免 exactOptionalPropertyTypes 问题）
      if (obj.ownership != null) {
        result.ownership = obj.ownership;
      }

      return result;
    } catch (e) {
      console.error('[KataGoResultParser] Failed to parse turn result', e);
      return null;
    }
  }

  /**
   * 解析单局面分析结果（兼容现有 IAIEngine.analyze 返回格式）
   */
  static parseSingleAnalysis(rawJson: string) {
    const turn = this.parseTurnResult(rawJson);
    if (!turn) {
      console.error('[KataGoResultParser] parseTurnResult returned null');
      throw new Error('Failed to parse analysis result');
    }

    const result = {
      rootWinRate: turn.rootWinRate,
      rootScoreLead: turn.rootScoreLead,
      rootScoreSelfplay: turn.moveInfos[0]?.scoreMean ?? turn.rootScoreLead,
      rootScoreStdev: turn.moveInfos[0]?.scoreStdev ?? 0,
      rootVisits: turn.rootVisits,
      ownership: turn.ownership ? new Float32Array(turn.ownership) : new Float32Array(361),
      ownershipStdev: new Float32Array(361),
      policy: new Float32Array(362),
      moves: turn.moveInfos.map(mi => {
        const coord = KataGoQueryBuilder.gtpToMove(mi.move);
        return {
          x: coord.x,
          y: coord.y,
          winRate: mi.winrate ?? 0,
          winRateLost: 0,
          scoreLead: mi.scoreLead ?? 0,
          scoreSelfplay: mi.scoreMean ?? 0,
          scoreStdev: mi.scoreStdev ?? 0,
          visits: mi.visits ?? 0,
          pointsLost: 0,
          relativePointsLost: 0,
          order: mi.order,
          prior: mi.prior,
          pv: mi.pv,  // 保持原始的 GTP 格式（如 "Q16", "D4"）
        };
      }),
    };

    return result;
  }
}
