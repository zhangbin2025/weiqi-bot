/**
 * @fileoverview OGS SGF 生成器
 *
 * 支持生成带 AI 复盘数据的 SGF：
 * - 每手包含胜率、目差注释
 * - 关键手包含 AI 推荐选点分支（top 5）
 * - SGF 分支结构符合规范，主流线为第一个子分支
 */
import type { GameMetadata } from '../base/types';
import type { OgsGameResponse, OgsGameData } from './types';
import type { OgsAiReviewSummary, OgsAiReviewMove } from './types';

export class OgsSgfGenerator {
  /**
   * 生成 SGF 内容（不含 AI review）
   */
  generate(data: OgsGameResponse, metadata: GameMetadata): string {
    return this.generateWithAiReview(data, metadata, null);
  }

  /**
   * 生成带 AI Review 数据的 SGF
   *
   * @param aiReview - AI Review 汇总数据，null 表示无 AI review
   */
  generateWithAiReview(
    data: OgsGameResponse,
    metadata: GameMetadata,
    aiReview: OgsAiReviewSummary | null
  ): string {
    const gamedata = data.gamedata || {};
    const rawMoves = gamedata.moves || [];

    // 截掉末尾连续的 pass 手（OGS 对局结束时双方 pass）
    const moves = this.trimTrailingPasses(rawMoves);

    // 处理自由让子：前 handicap 手全是黑棋，提取为 AB[] 而非正常着法
    let handicapStones: string[] = [];
    let playMoves = moves;
    if (gamedata.free_handicap_placement && gamedata.handicap > 0) {
      const hc = gamedata.handicap;
      for (let i = 0; i < hc && i < moves.length; i++) {
        const m = moves[i]!;
        if (m.length >= 2 && m[0]! >= 0 && m[1]! >= 0) {
          handicapStones.push(this.coordToSgf(m[0]!, m[1]!, metadata.height));
        }
      }
      playMoves = moves.slice(hc); // 让子后的着法
    }

    // 让子棋后第一手的颜色：自由让子时白方先行
    const firstMoveColor = gamedata.free_handicap_placement && gamedata.handicap > 0
      ? 'W'
      : (gamedata.initial_player || 'black') === 'white' ? 'W' : 'B';

    // AI review 索引偏移：自由让子时，win_rates/scores 的索引从让子后的第一手开始
    // 需要调整 aiReview 的 moveDetails key（减去 handicap 偏移）
    const aiReviewAdjusted = this.adjustAiReviewForHandicap(aiReview, handicapStones.length);

    // 头部（含 AB 让子位置）
    const header = this.buildHeader(data, metadata, gamedata, aiReviewAdjusted, handicapStones);

    // 着法
    const body = this.buildBody(playMoves, firstMoveColor, metadata.height, aiReviewAdjusted);

    return header + body + ')';
  }

  /**
   * 调整 AI Review 数据的索引偏移（自由让子棋专用）
   *
   * OGS 的 win_rates/scores 数组可能包含让子阶段的每手数据，
   * 也可能从让子后的第一手开始。需要对应到实际着法索引。
   *
   * move-N 的 N 是 1-based，对应 OGS moves 数组的索引（包含让子手）。
   * 当 playMoves = moves.slice(handicap) 时，playMoves[0] 对应 moves[handicap]。
   * 所以 moveDetails 的 key 需要减去 handicap 偏移。
   */
  private adjustAiReviewForHandicap(
    aiReview: OgsAiReviewSummary | null,
    handicapOffset: number
  ): OgsAiReviewSummary | null {
    if (!aiReview || handicapOffset === 0) {
      return aiReview;
    }

    // moveDetails key: 1-based move-N 转 0-based 后减去 handicap 偏移
    const adjustedDetails = new Map<number, OgsAiReviewMove>();
    for (const [key, value] of aiReview.moveDetails) {
      const adjustedKey = key - handicapOffset;
      if (adjustedKey >= 0) {
        adjustedDetails.set(adjustedKey, value);
      }
    }

    // winRates/scores: 截掉前 handicapOffset 个（让子阶段的胜率），
    // 使 winRates[0] 对应 playMoves[0]
    const adjustedWinRates = aiReview.winRates.slice(handicapOffset);
    const adjustedScores = aiReview.scores.slice(handicapOffset);

    return {
      ...aiReview,
      winRates: adjustedWinRates,
      scores: adjustedScores,
      moveDetails: adjustedDetails,
    };
  }

  /**
   * 构建 SGF 头部
   */
  private buildHeader(
    data: OgsGameResponse,
    metadata: GameMetadata,
    gamedata: OgsGameData,
    aiReview: OgsAiReviewSummary | null,
    handicapStones: string[]
  ): string {
    const parts: string[] = ['(;GM[1]FF[4]CA[UTF-8]'];

    parts.push(
      metadata.width === metadata.height
        ? `SZ[${metadata.width}]`
        : `SZ[${metadata.width}:${metadata.height}]`
    );
    parts.push(`PB[${metadata.blackName}]`);
    parts.push(`PW[${metadata.whiteName}]`);

    if (metadata.blackRank) parts.push(`BR[${metadata.blackRank}]`);
    if (metadata.whiteRank) parts.push(`WR[${metadata.whiteRank}]`);
    parts.push(`KM[${metadata.komi}]`);
    if (metadata.date) parts.push(`DT[${metadata.date}]`);
    if (metadata.result) parts.push(`RE[${metadata.result}]`);

    // 让子棋
    if (metadata.handicap > 0) {
      parts.push(`HA[${metadata.handicap}]`);
      // 优先使用传入的让子位置（自由让子已提取）
      // 否则从 initial_state 读取
      let stones = handicapStones;
      if (stones.length === 0) {
        stones = this.getHandicapStonesFromInitialState(gamedata, metadata.width, metadata.height);
      }
      for (const coord of stones) {
        parts.push(`AB[${coord}]`);
      }
    }

    // 规则
    const ruleMap: Record<string, string> = {
      japanese: 'JP', chinese: 'CN', korean: 'KO', aga: 'AGA', ing: 'ING',
    };
    parts.push(`RU[${ruleMap[metadata.rules] || 'JP'}]`);

    // AI review 元数据注释
    if (aiReview) {
      const networkShort = aiReview.network.substring(0, 20);
      const finalWr = (aiReview.finalWinRate * 100).toFixed(1);
      parts.push(`C[AI: ${aiReview.engine} | Network: ${networkShort}... | Final WR: ${finalWr}%]`);
    }

    return parts.join('');
  }

  /**
   * 构建着法部分（含 AI review 数据）
   *
   * 策略：先构建线性主线字符串，再从最后一个分支手往前处理，
   * 在每个分支手位置将主线截断，插入分支括号。
   *
   * 这样避免了递归嵌套导致选点分支被推到 SGF 末尾的问题。
   */
  private buildBody(
    moves: number[][],
    firstMoveColor: string,
    height: number,
    aiReview: OgsAiReviewSummary | null
  ): string {
    if (!aiReview) {
      return this.buildLinearMoves(moves, firstMoveColor, height);
    }

    // 1. 收集所有分支手的索引，按降序排列（从后往前处理）
    const branchIndices: number[] = [];
    for (const [idxStr] of aiReview.moveDetails) {
      const idx = idxStr;
      if (idx >= 0 && idx < moves.length) {
        branchIndices.push(idx);
      }
    }
    branchIndices.sort((a, b) => b - a); // 降序

    // 2. 构建完整的线性主线
    const nodeStrings: string[] = [];
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]!;
      if (move.length < 2) continue;
      const x = move[0]!, y = move[1]!;
      const coord = this.coordToSgf(x, y, height);
      const color = i % 2 === 0 ? firstMoveColor : (firstMoveColor === 'B' ? 'W' : 'B');
      const comment = this.buildMoveComment(i, aiReview);
      const node = `;${color}[${coord}]` + (comment ? `C[${comment}]` : '');
      nodeStrings.push(node);
    }

    // nodeStrings[i] 对应 moves 中的第 i 个有效手
    // 但 moves 中可能有无效手（length < 2），需要建立映射
    // 简化：假设没有无效手（OGS moves 格式固定 [x, y, timestamp]）
    // 所以 nodeStrings[i] = 第 i 手

    // 3. 从后往前，在每个分支手位置插入选点分支
    // SGF 结构：;当前手C[注释](;下一手...主线剩余...)(;选点1)(;选点2)...
    for (const branchIdx of branchIndices) {
      const moveDetail = aiReview.moveDetails.get(branchIdx);
      if (!moveDetail) continue;

      // 选点的颜色 = 下一手的颜色（分支手之后的下一手）
      const nextIdx = branchIdx + 1;
      const nextColor = nextIdx < moves.length
        ? (nextIdx % 2 === 0 ? firstMoveColor : (firstMoveColor === 'B' ? 'W' : 'B'))
        : firstMoveColor;

      const variations = this.buildVariations(moveDetail, nextColor, height);
      if (variations.length === 0) continue;

      // 当前手节点之后的所有内容（主线剩余 + 已插入的分支）
      const mainRest = nodeStrings.slice(nextIdx).join('');

      // 重建：当前手 + (主线剩余) + (选点1) + ... (选点N)
      // 注意：当前手节点不变，在其后面插入括号
      nodeStrings.length = branchIdx + 1; // 截断到当前手
      nodeStrings.push(`(${mainRest})`);
      for (const v of variations) {
        nodeStrings.push(v);
      }
    }

    return nodeStrings.join('');
  }

  /**
   * 线性着法（无 AI review）
   */
  private buildLinearMoves(
    moves: number[][],
    firstMoveColor: string,
    height: number
  ): string {
    const parts: string[] = [];
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]!;
      if (move.length < 2) continue;
      const x = move[0]!, y = move[1]!;
      const coord = this.coordToSgf(x, y, height);
      const color = i % 2 === 0 ? firstMoveColor : (firstMoveColor === 'B' ? 'W' : 'B');
      parts.push(`;${color}[${coord}]`);
    }
    return parts.join('');
  }

  /*
   * 旧的递归构建方法已废弃， replaced by iterative buildBody above.
   * 递归方法的问题是：多个分支手嵌套时，选点分支被推到 SGF 末尾。
   */

  /**
   * 构建单手注释（胜率、目差、手数）
   */
  private buildMoveComment(
    moveIndex: number,
    aiReview: OgsAiReviewSummary
  ): string | null {
    const wr = aiReview.winRates[moveIndex];
    const sc = aiReview.scores[moveIndex];

    const parts: string[] = [];
    if (wr !== undefined) {
      parts.push(`胜率: ${(wr * 100).toFixed(1)}%`);
    }
    if (sc !== undefined) {
      parts.push(`目差: ${sc.toFixed(1)}`);
    }
    parts.push(`第${moveIndex + 1}手`);

    return parts.length > 0 ? parts.join(' | ') : null;
  }

  /**
   * 构建 AI 选点分支
   *
   * 每个 branch 的 moves 是一个多手序列（AI 推荐的后续着法），
   * 需要完整输出为 SGF 分支，交替黑白着法。
   *
   * @param moveDetail - 该手的 AI 详细数据
   * @param nextColor - 下一手的颜色（即推荐选点的颜色）
   * @param height - 棋盘高度
   * @returns SGF 分支字符串数组
   */
  private buildVariations(
    moveDetail: OgsAiReviewMove,
    nextColor: string,
    height: number
  ): string[] {
    const branches = moveDetail.branches || [];
    if (branches.length === 0) {
      return [];
    }

    // OGS 原始 branches 顺序已按 visits 降序排列，即推荐顺序（一选在前）
    // 不重新排序，保持原始顺序

    const result: string[] = [];
    for (let j = 0; j < branches.length; j++) {
      const branch = branches[j]!;
      const branchMoves = branch.moves || [];
      if (branchMoves.length === 0) continue;

      // 构建分支内的着法序列
      const moveParts: string[] = [];
      for (let k = 0; k < branchMoves.length; k++) {
        const m = branchMoves[k]!;
        const { x, y } = m;
        if (x === undefined || y === undefined || x < 0 || y < 0) continue;
        const coord = this.coordToSgf(x, y, height);
        const color = k % 2 === 0 ? nextColor : (nextColor === 'B' ? 'W' : 'B');
        moveParts.push(`;${color}[${coord}]`);
      }

      if (moveParts.length === 0) continue;

      const wr = (branch.win_rate * 100).toFixed(1);
      const sc = branch.score.toFixed(1);
      const visits = branch.visits || 0;

      // 第一个节点带注释，后续着法无注释
      const firstNode = moveParts[0]!;
      const commentedFirst = firstNode + `C[选点${j + 1}: 胜率=${wr}% 目差=${sc} 访问=${visits}]`;
      const restMoves = moveParts.slice(1).join('');

      result.push(`(${commentedFirst}${restMoves})`);
    }

    return result;
  }

  /**
   * 截掉末尾连续的 pass 手
   * OGS 对局结束时双方会 pass，这些 pass 不携带有用信息
   */
  private trimTrailingPasses(moves: number[][]): number[][] {
    let end = moves.length;
    while (end > 0) {
      const m = moves[end - 1]!;
      if (m.length >= 2 && m[0] === -1 && m[1] === -1) {
        end--;
      } else {
        break;
      }
    }
    return moves.slice(0, end);
  }

  /**
   * OGS 坐标转 SGF 坐标
   * OGS: (0,0) = 左下角
   * SGF: (0,0) = 左下角（与 OGS 一致，无需翻转）
   */
  private coordToSgf(x: number, y: number, _height: number): string {
    if (x === -1 && y === -1) {
      return 'tt'; // pass（SGF FF[3] 使用 tt，FF[4] 19路也兼容）
    }
    const sgfX = String.fromCharCode(97 + x);
    const sgfY = String.fromCharCode(97 + y);
    return sgfX + sgfY;
  }

  /**
   * 从 OGS initial_state 获取让子位置
   */
  private getHandicapStonesFromInitialState(
    gamedata: OgsGameData,
    width: number,
    height: number
  ): string[] {
    const coords: string[] = [];

    const initialState = gamedata.initial_state;
    if (initialState?.black) {
      const blackStr = initialState.black;
      for (let i = 0; i + 1 < blackStr.length; i += 2) {
        coords.push(blackStr.substring(i, i + 2));
      }
      if (coords.length > 0) {
        return coords;
      }
    }

    return this.getHandicapStones(gamedata.handicap || 0, width, height);
  }

  /**
   * 获取让子位置（标准星位）
   */
  private getHandicapStones(handicap: number, width: number, height: number): string[] {
    const coords: string[] = [];
    if (width !== height) return coords;
    const size = width;
    let starPoints: number[][] = [];
    if (size === 19) {
      starPoints = [
        [3, 3], [15, 15], [15, 3], [3, 15], [9, 9],
        [3, 9], [15, 9], [9, 3], [9, 15],
      ];
    } else if (size === 13) {
      starPoints = [
        [3, 3], [9, 9], [9, 3], [3, 9], [6, 6],
        [3, 6], [9, 6], [6, 3], [6, 9],
      ];
    } else if (size === 9) {
      starPoints = [
        [2, 2], [6, 6], [6, 2], [2, 6], [4, 4],
      ];
    } else {
      // 其他尺寸：使用通用计算
      const edge = size >= 11 ? 3 : 2;
      const mid = Math.floor(size / 2);
      starPoints = [
        [edge, edge], [size - 1 - edge, size - 1 - edge],
        [size - 1 - edge, edge], [edge, size - 1 - edge],
        [mid, mid],
      ];
    }
    for (let i = 0; i < Math.min(handicap, starPoints.length); i++) {
      const [x, y] = starPoints[i]!;
      coords.push(this.coordToSgf(x!, y!, height));
    }
    return coords;
  }
}
