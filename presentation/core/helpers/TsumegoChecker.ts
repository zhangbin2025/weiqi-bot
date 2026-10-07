/**
 * 死活题试下匹配检查器
 * @module presentation/core/helpers/TsumegoChecker
 * @description 检测试下着法是否与死活题答案分支匹配
 */

import type { ReplayData, ReplayNode } from '../../../domain/sgf';
import { coordToPos } from '../../../domain/sgf';

/** 做题模式相关类型 */
export type TsumegoSolveStatus = 'wrong' | 'continue' | 'solved';

/** 做题模式单步判定结果 */
export interface TsumegoSolveResult {
  status: TsumegoSolveStatus;
  /** status==='continue' 时有效：应对方（机器）应回应的着法 */
  opponentMove?: { x: number; y: number; color: 'B' | 'W' };
}

/** 匹配结果类型 */
export type TsumegoMatchResult = 
  | { type: 'correct'; branchComment: string; branchIndex: number }
  | { type: 'wrong'; branchComment: string; branchIndex: number }
  | { type: 'partial'; branchComment: string; branchIndex: number; nextMove: string | null; branchType: BranchInfo['branchType'] }
  | { type: 'no_match'; message: string }
  | { type: 'not_tsumego' };

/** 分支信息 */
export interface BranchInfo {
  index: number;
  comment: string;
  branchType: 'correct' | 'variation' | 'wrong' | 'unknown';
  moves: Array<{ color: 'B' | 'W'; coord: string; x: number; y: number }>;
}

/**
 * 死活题检查器
 * 
 * 判断逻辑：
 * 1. 传统死活题：有初始棋子(AB/AW) + 至少一个子分支 + 分支有死活题注释
 *    备用：有初始棋子 + 有分支 + 主分支无着法
 * 2. OGS 风格死活题：无摆子 + 有子分支 + 分支有死活题注释 + max_moves=0
 * 3. 每个分支的着法序列是答案
 * 4. 分支注释 C[正解图]/C[变化图]/C[失败图] 标识分支类型
 * 5. 用户试下时，逐手匹配分支着法
 */
export class TsumegoChecker {
  private branches: BranchInfo[] = [];
  private isTsumego: boolean = false;
  /** 做题模式下锁定的正解分支索引 */
  private solveTrackBranch: number | null = null;
  /** 做题模式下用户已落子数（不含机器回应） */
  private solveUserMoves: number = 0;

  /**
   * 从 ReplayData 初始化
   */
  init(replayData: ReplayData | null): void {
    this.branches = [];
    this.isTsumego = false;

    if (!replayData) return;

    // 判断是否为死活题：
    // 1. 传统死活题：有摆子(AB/AW) + 有子分支 + 分支含死活题注释
    //    备用：有摆子 + 有分支 + 主分支无着法(max_moves=0)
    // 2. OGS 风格死活题：无摆子 + 有子分支 + 分支含死活题注释
    const hasInitialStones = !!(replayData.handicap_stones && replayData.handicap_stones.length > 0);
    const hasBranches = !!(replayData.tree.children && replayData.tree.children.length >= 1);
    const hasTsumegoComment = this.hasTsumegoBranchComment(replayData.tree);

    if (hasInitialStones && hasBranches && hasTsumegoComment) {
      // 模式1：传统死活题（有摆子 + 答案分支 + 注释）
      this.isTsumego = true;
      this.branches = this.extractBranches(replayData.tree);
    } else if (hasInitialStones && hasBranches && replayData.max_moves === 0) {
      // 备用检测：有初始棋子 + 有分支 + 主分支无着法
      // 无标准注释但可能是死活题（非101来源）
      this.isTsumego = true;
      this.branches = this.extractBranches(replayData.tree);
    } else if (!hasInitialStones && hasBranches && hasTsumegoComment) {
      // 模式2：OGS 风格死活题（无摆子 + 答案分支 + 注释）
      this.isTsumego = true;
      this.branches = this.extractBranches(replayData.tree);
    }
  }

  /**
   * 是否为死活题
   */
  getIsTsumego(): boolean {
    return this.isTsumego;
  }

  /**
   * 获取所有分支信息
   */
  getBranches(): BranchInfo[] {
    return this.branches;
  }

  /**
   * 检查是否有死活题分支注释
   */
  private hasTsumegoBranchComment(rootNode: ReplayNode): boolean {
    if (!rootNode.children) return false;
    for (const child of rootNode.children) {
      const comment = child.properties?.C || '';
      if (comment.includes('正解') || comment.includes('变化') || comment.includes('失败')) {
        return true;
      }
    }
    return false;
  }

  /**
   * 从树中提取分支信息
   */
  private extractBranches(rootNode: ReplayNode): BranchInfo[] {
    const branches: BranchInfo[] = [];
    if (!rootNode.children) return branches;

    for (let i = 0; i < rootNode.children.length; i++) {
      const child = rootNode.children[i]!;
      const comment = child.properties?.C || '';
      const branchType = this.parseBranchType(comment);

      // 提取分支内的着法序列
      // 分支的第一个节点可能有 C 属性但无着法（仅注释）
      // 也可能第一个节点既有 C 又有着法
      const moves: Array<{ color: 'B' | 'W'; coord: string; x: number; y: number }> = [];
      this.collectMoves(child, moves);

      branches.push({
        index: i,
        comment,
        branchType,
        moves,
      });
    }

    return branches;
  }

  /**
   * 递归收集着法（沿主分支链）
   */
  private collectMoves(node: ReplayNode, moves: Array<{ color: 'B' | 'W'; coord: string; x: number; y: number }>): void {
    // 当前节点有着法
    if (node.color && node.coord) {
      const pos = coordToPos(node.coord);
      if (pos) {
        moves.push({ color: node.color, coord: node.coord, x: pos.x, y: pos.y });
      }
    }

    // 继续子节点（取第一个子节点，即主分支链）
    if (node.children && node.children.length > 0) {
      this.collectMoves(node.children[0]!, moves);
    }
  }

  /**
   * 从注释解析分支类型
   */
  private parseBranchType(comment: string): BranchInfo['branchType'] {
    if (!comment) return 'unknown';
    if (comment.includes('正解')) return 'correct';
    if (comment.includes('变化')) return 'variation';
    if (comment.includes('失败')) return 'wrong';
    return 'unknown';
  }

  /**
   * 检查用户试下着法是否匹配某个分支
   * @param trialMoves - 用户试下的着法列表 [{x, y, color}]
   * @param preMoves - 进入试下前主线已走的着法（可选，用于 move>0 时试下）
   * @returns 匹配结果
   */
  checkMatch(
    trialMoves: Array<{ x: number; y: number; color: string }>,
    preMoves?: Array<{ x: number; y: number; color: string }>
  ): TsumegoMatchResult {
    if (!this.isTsumego) return { type: 'not_tsumego' };

    if (trialMoves.length === 0 && (!preMoves || preMoves.length === 0)) {
      return { type: 'no_match', message: '请落子开始解题' };
    }

    // 拼合前导着法 + 试下着法，形成完整序列与分支比对
    const fullMoves = [...(preMoves ?? []), ...trialMoves];

    // 遍历所有分支，寻找匹配
    for (const branch of this.branches) {
      const matchResult = this.matchBranch(fullMoves, branch);
      if (matchResult) {
        return matchResult;
      }
    }

    // 没有匹配任何分支
    return { type: 'no_match', message: '未匹配任何已知变化' };
  }

  /**
   * 获取所有「正解」分支（branchType === 'correct'）
   */
  getCorrectBranches(): BranchInfo[] {
    return this.branches.filter(b => b.branchType === 'correct');
  }

  /**
   * 做题模式：重置解题状态（重新开始时调用）
   */
  resetSolve(): void {
    this.solveTrackBranch = null;
    this.solveUserMoves = 0;
  }

  /**
   * 做题模式单步判定
   *
   * 规则：
   * - 用户（先手方）下第 2k 手（k 从 0 起），机器（应对方）下第 2k+1 手
   * - 第一步：在所有「正解」分支里找第一步着法与用户一致的，随机锁定其一；
   *   若无匹配，返回 wrong
   * - 后续步：与锁定分支的对应着法比对；命中则返回应对方下一手（continue），
   *   若已走完该分支所有着法则返回 solved；不符返回 wrong
   *
   * @param userMove - 用户刚落下的一手
   * @returns 判定结果
   */
  solveMove(userMove: { x: number; y: number; color: 'B' | 'W' }): TsumegoSolveResult {
    if (!this.isTsumego) return { status: 'wrong' };

    const correctBranches = this.getCorrectBranches();
    if (correctBranches.length === 0) return { status: 'wrong' };

    // 第一步：尚未锁定分支
    if (this.solveTrackBranch === null) {
      const candidates = correctBranches.filter(b => {
        const first = b.moves[0];
        return first && first.color === userMove.color && first.x === userMove.x && first.y === userMove.y;
      });
      if (candidates.length === 0) {
        return { status: 'wrong' };
      }
      // 随机锁定一个正确分支
      const picked = candidates[Math.floor(Math.random() * candidates.length)]!;
      this.solveTrackBranch = picked.index;
      this.solveUserMoves = 1;
      // 取应对方下一手（moves[1]）
      const opponent = picked.moves[1];
      if (!opponent) {
        // 正解分支只有一手，用户走完即正解
        return { status: 'solved' };
      }
      return {
        status: 'continue',
        opponentMove: { x: opponent.x, y: opponent.y, color: opponent.color },
      };
    }

    // 后续步：与锁定分支比对
    const branch = this.branches.find(b => b.index === this.solveTrackBranch);
    if (!branch) return { status: 'wrong' };

    const expectedUser = branch.moves[this.solveUserMoves * 2];
    if (!expectedUser ||
        expectedUser.color !== userMove.color ||
        expectedUser.x !== userMove.x ||
        expectedUser.y !== userMove.y) {
      return { status: 'wrong' };
    }

    this.solveUserMoves++;
    const opponent = branch.moves[this.solveUserMoves * 2];
    if (!opponent) {
      return { status: 'solved' };
    }
    return {
      status: 'continue',
      opponentMove: { x: opponent.x, y: opponent.y, color: opponent.color },
    };
  }

  /**
   * 匹配单个分支
   */
  private matchBranch(
    trialMoves: Array<{ x: number; y: number; color: string }>,
    branch: BranchInfo
  ): TsumegoMatchResult | null {
    const branchMoves = branch.moves;
    
    // 着法数量超过分支长度
    if (trialMoves.length > branchMoves.length) {
      // 检查到分支结束前的着法是否都匹配
      const allMatch = this.matchMoves(trialMoves, branchMoves, branchMoves.length);
      if (allMatch) {
        // 用户走了分支的所有着法后继续走，说明分支已结束
        // 根据分支类型给出反馈
        if (branch.branchType === 'correct') {
          return { type: 'correct', branchComment: branch.comment, branchIndex: branch.index };
        } else if (branch.branchType === 'wrong') {
          return { type: 'wrong', branchComment: branch.comment, branchIndex: branch.index };
        } else {
          return { type: 'partial', branchComment: branch.comment, branchIndex: branch.index, nextMove: null, branchType: branch.branchType };
        }
      }
      return null;
    }

    // 逐手比较
    const allMatch = this.matchMoves(trialMoves, branchMoves, trialMoves.length);
    if (!allMatch) return null;

    // 完全匹配到当前
    if (trialMoves.length === branchMoves.length) {
      // 到达分支末尾
      if (branch.branchType === 'correct') {
        return { type: 'correct', branchComment: branch.comment, branchIndex: branch.index };
      } else if (branch.branchType === 'wrong') {
        return { type: 'wrong', branchComment: branch.comment, branchIndex: branch.index };
      } else {
        return { type: 'partial', branchComment: branch.comment, branchIndex: branch.index, nextMove: null, branchType: branch.branchType };
      }
    } else {
      // 部分匹配，还有后续着法
      const nextMove = branchMoves[trialMoves.length]?.coord ?? null;
      return { type: 'partial', branchComment: branch.comment, branchIndex: branch.index, nextMove, branchType: branch.branchType };
    }
  }

  /**
   * 比较前 n 手着法是否匹配
   */
  private matchMoves(
    trialMoves: Array<{ x: number; y: number; color: string }>,
    branchMoves: Array<{ color: 'B' | 'W'; coord: string; x: number; y: number }>,
    count: number
  ): boolean {
    for (let i = 0; i < count; i++) {
      const trial = trialMoves[i]!;
      const branch = branchMoves[i]!;

      // 比较坐标
      if (trial.x !== branch.x || trial.y !== branch.y) {
        return false;
      }

      // 比较颜色（trial color 是 'black'/'white'，branch 是 'B'/'W'）
      const trialColor = trial.color === 'black' ? 'B' : 'W';
      if (trialColor !== branch.color) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取提示信息
   * @param result - 匹配结果
   * @returns 适合显示的提示文字
   */
  formatHint(result: TsumegoMatchResult): string {
    switch (result.type) {
      case 'not_tsumego':
        return '';
      case 'no_match':
        return result.message;
      case 'correct':
        return '✓ 正解！' + (result.branchComment ? `（${result.branchComment}）` : '');
      case 'wrong':
        return '✗ 失败' + (result.branchComment ? `（${result.branchComment}）` : '');
      case 'partial': {
        const comment = result.branchComment || '匹配中';
        const suffix = result.nextMove ? ' - 继续试下' : '';
        switch (result.branchType) {
          case 'correct':
            return `✓ ${comment}进行中${suffix}`;
          case 'wrong':
            return `⚠ ${comment}进行中${suffix}`;
          case 'variation':
            return `~ ${comment}进行中${suffix}`;
          default:
            return `${comment}${suffix}`;
        }
      }
    }
  }

  /**
   * 获取提示对应的 CSS 类名
   * @param result - 匹配结果
   * @returns CSS 类名（不含基础 trial-hint）
   */
  getHintClass(result: TsumegoMatchResult): string {
    switch (result.type) {
      case 'correct':
        return 'correct';
      case 'wrong':
        return 'wrong';
      case 'partial':
        switch (result.branchType) {
          case 'correct':
            return 'partial-correct';
          case 'wrong':
            return 'partial-wrong';
          default:
            return 'partial';
        }
      default:
        return '';
    }
  }

  /**
   * 获取匹配状态图标
   */
  getStatusIcon(result: TsumegoMatchResult): string {
    switch (result.type) {
      case 'not_tsumego':
        return '';
      case 'no_match':
        return '❓';
      case 'correct':
        return '✅';
      case 'wrong':
        return '❌';
      case 'partial':
        return '🔹';
    }
  }
}
