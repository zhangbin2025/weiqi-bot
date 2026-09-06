/**
 * 死活题试下匹配检查器
 * @module presentation/core/helpers/TsumegoChecker
 * @description 检测试下着法是否与死活题答案分支匹配
 */

import type { ReplayData, ReplayNode } from '../../../domain/sgf';
import { coordToPos } from '../../../domain/sgf';

/** 匹配结果类型 */
export type TsumegoMatchResult = 
  | { type: 'correct'; branchComment: string; branchIndex: number }
  | { type: 'wrong'; branchComment: string; branchIndex: number }
  | { type: 'partial'; branchComment: string; branchIndex: number; nextMove: string | null }
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
 * 1. 检测是否为死活题：有初始棋子(AB/AW) + 至少一个子分支 + 分支有死活题注释
 *    备用：有初始棋子 + 有分支 + 主分支无着法
 * 2. 每个分支的着法序列是答案
 * 3. 分支注释 C[正解图]/C[变化图]/C[失败图] 标识分支类型
 * 4. 用户试下时，逐手匹配分支着法
 */
export class TsumegoChecker {
  private branches: BranchInfo[] = [];
  private isTsumego: boolean = false;

  /**
   * 从 ReplayData 初始化
   */
  init(replayData: ReplayData | null): void {
    this.branches = [];
    this.isTsumego = false;

    if (!replayData) return;

    // 判断是否为死活题：
    // 1. 有初始棋子 (AB/AW)
    // 2. 至少一个子分支（答案分支）
    // 3. 至少一个分支有死活题类型注释（正解/变化/失败）
    const hasInitialStones = !!(replayData.handicap_stones && replayData.handicap_stones.length > 0);
    const hasBranches = !!(replayData.tree.children && replayData.tree.children.length >= 1);
    const hasTsumegoComment = this.hasTsumegoBranchComment(replayData.tree);

    if (hasInitialStones && hasBranches && hasTsumegoComment) {
      this.isTsumego = true;
      this.branches = this.extractBranches(replayData.tree);
    } else if (hasInitialStones && hasBranches && replayData.max_moves === 0) {
      // 备用检测：有初始棋子 + 有分支 + 主分支无着法
      // 无标准注释但可能是死活题（非101来源）
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
   * @returns 匹配结果
   */
  checkMatch(trialMoves: Array<{ x: number; y: number; color: string }>): TsumegoMatchResult {
    if (!this.isTsumego) return { type: 'not_tsumego' };

    if (trialMoves.length === 0) {
      return { type: 'no_match', message: '请落子开始解题' };
    }

    // 遍历所有分支，寻找匹配
    for (const branch of this.branches) {
      const matchResult = this.matchBranch(trialMoves, branch);
      if (matchResult) {
        return matchResult;
      }
    }

    // 没有匹配任何分支
    return { type: 'no_match', message: '未匹配任何已知变化' };
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
          return { type: 'partial', branchComment: branch.comment, branchIndex: branch.index, nextMove: null };
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
        return { type: 'partial', branchComment: branch.comment, branchIndex: branch.index, nextMove: null };
      }
    } else {
      // 部分匹配，还有后续着法
      const nextMove = branchMoves[trialMoves.length]?.coord ?? null;
      return { type: 'partial', branchComment: branch.comment, branchIndex: branch.index, nextMove };
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
        if (result.nextMove) {
          return `~ ${comment} - 继续试下`;
        }
        return `~ ${comment}`;
      }
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
