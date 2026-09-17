/**
 * @fileoverview OGS (Online-Go.com) 死活题提供者实现
 *
 * 通过 REST API 获取 OGS 死活题数据，转换为 101 围棋格式的 SGF。
 *
 * API 无需鉴权，直接返回完整题目数据（含 move_tree 分支树）。
 *
 * SGF 格式转换：
 * OGS move_tree 的 correct_answer/wrong_answer 标记
 * 转换为 101 围棋格式（正解图/变化图/失败图注释在分支首节点上），
 * 使 replay 页面的死活题处理逻辑无需修改。
 *
 * URL 格式：
 * - https://online-go.com/puzzle/{ID}
 * - https://online-go.com/puzzles/{ID}
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming, GameMetadata } from '../base/types';
import type { IOgsPuzzleProvider } from './IOgsPuzzleProvider';
import type {
  OgsPuzzleDetail,
  OgsPuzzleMoveTree,
  OgsPuzzleListItem,
  OgsPuzzleListResponse,
  OgsPuzzleBranch,
} from './types';

/** OGS API 基础 URL */
const OGS_API_URL = 'https://online-go.com/api/v1';

/** 分支类型常量 */
const BRANCH_TYPE_CORRECT = '正解图';
const BRANCH_TYPE_WRONG = '失败图';
const BRANCH_TYPE_VARIATION = '变化图';

/**
 * OGS 死活题提供者
 */
export class OgsPuzzleProvider extends BaseProvider implements IOgsPuzzleProvider {
  readonly name = 'ogs-puzzle';
  readonly displayName = 'OGS Puzzle';
  readonly urlPatterns = [
    /online-go\.com\/puzzle\/(\d+)/,
    /online-go\.com\/puzzles\/(\d+)/,
  ];

  async fetchById(puzzleId: string): Promise<FetchResult> {
    const url = `https://online-go.com/puzzle/${puzzleId}`;
    return this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const puzzleId = this.extractId(url);
    if (!puzzleId) {
      return this.createErrorResult(url, '无法从 URL 提取题目 ID', timing);
    }

    try {
      const apiStart = this.now();
      const apiUrl = `${OGS_API_URL}/puzzles/${puzzleId}/`;

      const response = await this.network.request<string>({
        url: apiUrl,
        method: 'GET',
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
          Accept: 'application/json',
        },
      });

      timing.apiRequest = this.now() - apiStart;

      const detail = this.parseDetail(response.data);
      if (!detail) {
        return this.createErrorResult(url, '无法解析题目数据', timing);
      }

      const sgfStart = this.now();
      const sgfContent = this.convertTo101Format(detail);
      timing.sgfGeneration = this.now() - sgfStart;

      const metadata = this.buildMetadata(detail, puzzleId);

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata,
        timing,
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        '下载失败: ' + (error instanceof Error ? error.message : String(error)),
        timing,
      );
    }
  }

  async fetchPuzzleList(
    count?: number,
    keyword?: string,
  ): Promise<Array<{ title: string; subtitle: string; date: string; url: string }>> {
    const maxCount = count ?? 20;
    const kw = keyword?.trim().toLowerCase() || '';
    const results: Array<{ title: string; subtitle: string; date: string; url: string }> = [];

    try {
      const pageSize = Math.min(maxCount, 50);
      let page = 1;

      while (results.length < maxCount) {
        const apiUrl = `${OGS_API_URL}/puzzles/?page=${page}&page_size=${pageSize}&ordering=-modified`;

        const response = await this.network.request<string>({
          url: apiUrl,
          method: 'GET',
          responseType: 'text',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
            Accept: 'application/json',
          },
        });

        const listData = this.parseListResponse(response.data);
        if (listData.results.length === 0) break;

        for (const item of listData.results) {
          if (results.length >= maxCount) break;

          const name = item.name || ('Puzzle ' + item.id);
          const dateStr = (item.modified || item.created || '').slice(0, 10);

          if (kw) {
            const matchName = name.toLowerCase().includes(kw);
            const matchId = String(item.id).includes(kw);
            const matchDate = dateStr.toLowerCase().includes(kw);
            if (!matchName && !matchId && !matchDate) continue;
          }

          results.push({
            title: 'OGS-' + item.id,
            subtitle: name,
            date: dateStr,
            url: `https://online-go.com/puzzle/${item.id}`,
          });
        }

        if (!listData.next) break;
        page++;
        if (page > 20) break; // 安全限制
      }
    } catch (error) {
      console.error('[OgsPuzzleProvider] fetchPuzzleList failed:', error);
    }

    return results;
  }

  // ─── SGF 格式转换 ──────────────────────────────────────────

  /**
   * 将 OGS puzzle 数据转换为 101 围棋格式 SGF
   *
   * 转换规则：
   * 1. 根节点保留 AB/AW 初始棋子（从 initial_state 提取）
   * 2. move_tree 的每个顶层 branch 转换为一个 SGF 分支
   *    - 子树中含 correct_answer → 正解图
   *    - 子树中含 wrong_answer → 失败图
   *    - 其他 → 变化图
   * 3. 每个分支沿主链（branches[0]）收集着法序列
   * 4. 着法颜色由 initial_player 决定，按步数交替
   * 5. 按类型排序：正解图 → 变化图 → 失败图
   */
  private convertTo101Format(detail: OgsPuzzleDetail): string {
    const puzzle = detail.puzzle;
    const moveTree = puzzle.move_tree;
    const boardSize = puzzle.width;
    const isWhiteFirst = puzzle.initial_player === 'white';

    // 第一手颜色
    const firstColor: 'B' | 'W' = isWhiteFirst ? 'W' : 'B';

    // 提取初始棋子
    const blackStones = this.extractInitialStateStones(puzzle.initial_state?.black);
    const whiteStones = this.extractInitialStateStones(puzzle.initial_state?.white);

    // 提取所有答案分支（含正确颜色）
    const branches = this.extractBranches(moveTree, firstColor);

    // 排序：正解图 → 变化图 → 失败图
    const typeOrder: Record<string, number> = {
      [BRANCH_TYPE_CORRECT]: 0,
      [BRANCH_TYPE_VARIATION]: 1,
      [BRANCH_TYPE_WRONG]: 2,
    };
    branches.sort(
      (a, b) => (typeOrder[a.typeName] ?? 99) - (typeOrder[b.typeName] ?? 99),
    );

    // 构建 SGF
    const parts: string[] = [];
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push('SZ[' + boardSize + ']');

    const puzzleName = puzzle.name || ('OGS-' + detail.id);
    const typeName = detail.type || 'puzzle';
    const rankStr = this.formatRank(detail.rank);
    parts.push('PB[' + (isWhiteFirst ? 'White' : puzzleName) + ']');
    parts.push('PW[' + (isWhiteFirst ? puzzleName : 'OGS ' + typeName + ' ' + rankStr) + ']');

    // 题目描述
    const desc =
      'OGS-' + detail.id + ' - ' + typeName + ' ' + rankStr + ' - ' +
      (isWhiteFirst ? '白先' : '黑先');
    parts.push('C[' + desc + ']');

    // 先手方标注
    if (isWhiteFirst) {
      parts.push('PL[W]');
    }

    // 初始棋子
    for (const pos of blackStones) parts.push('AB[' + pos + ']');
    for (const pos of whiteStones) parts.push('AW[' + pos + ']');

    // 答案分支
    for (const branch of branches) {
      parts.push('\n(');
      parts.push('C[' + branch.typeName + ']');
      for (const move of branch.moves) {
        parts.push(';' + move.color + '[' + move.coord + ']');
      }
      parts.push(')');
    }

    parts.push(')');
    return parts.join('');
  }

  // ─── move_tree 解析 ───────────────────────────────────────

  /**
   * 从 move_tree 中提取所有答案分支
   *
   * move_tree 结构：
   * {
   *   x: -1, y: -1,           // 根节点（无着法）
   *   branches: [
   *     { x, y, correct_answer: true, text: "..." },     // 正解
   *     { x, y, wrong_answer: true, branches: [...] },    // 失败（含后续变化）
   *     { x, y, branches: [...] },                        // 变化
   *   ]
   * }
   *
   * 每个顶层 branch 对应一个 SGF 分支。
   * 分支内的着法序列沿主链（branches[0]）收集。
   * 着法颜色按步数交替：第0步 = firstColor，第1步 = 对方，...
   */
  private extractBranches(
    moveTree: OgsPuzzleMoveTree,
    firstColor: 'B' | 'W',
  ): Array<{
    typeName: string;
    moves: Array<{ color: 'B' | 'W'; coord: string }>;
  }> {
    const branches: Array<{
      typeName: string;
      moves: Array<{ color: 'B' | 'W'; coord: string }>;
    }> = [];

    const topLevelBranches = moveTree.branches || [];

    for (const branch of topLevelBranches) {
      const typeName = this.getBranchType(branch);
      const moves = this.collectBranchMoves(branch, firstColor);
      branches.push({ typeName, moves });
    }

    return branches;
  }

  /**
   * 判断分支类型
   *
   * OGS 的 correct_answer/wrong_answer 标记可能不在顶层 branch 节点上，
   * 而是嵌在深层子节点中。因此需要递归检查整个子树：
   * - 子树中任意节点有 correct_answer → 正解图
   * - 子树中任意节点有 wrong_answer（且无 correct_answer）→ 失败图
   * - 都没有 → 变化图
   */
  private getBranchType(branch: OgsPuzzleBranch): string {
    const has = this.checkBranchTags(branch);
    if (has.correct) return BRANCH_TYPE_CORRECT;
    if (has.wrong) return BRANCH_TYPE_WRONG;
    return BRANCH_TYPE_VARIATION;
  }

  /**
   * 递归检查子树中是否包含 correct_answer / wrong_answer 标记
   */
  private checkBranchTags(branch: OgsPuzzleBranch): { correct: boolean; wrong: boolean } {
    let correct = !!branch.correct_answer;
    let wrong = !!branch.wrong_answer;

    if (branch.branches) {
      for (const child of branch.branches) {
        const childResult = this.checkBranchTags(child);
        correct = correct || childResult.correct;
        wrong = wrong || childResult.wrong;
      }
    }

    return { correct, wrong };
  }

  /**
   * 沿主链收集分支着法序列
   *
   * @param branch - 当前分支节点
   * @param firstColor - 第一手的颜色 ('B' 或 'W')
   *
   * 着法颜色按步数交替：
   * 第0步 = firstColor，第1步 = 对方，第2步 = firstColor，...
   *
   * 沿 branches[0] 主链收集所有 {x, y} 坐标。
   */
  private collectBranchMoves(
    branch: OgsPuzzleBranch,
    firstColor: 'B' | 'W',
  ): Array<{ color: 'B' | 'W'; coord: string }> {
    const moves: Array<{ color: 'B' | 'W'; coord: string }> = [];
    const opponentColor: 'B' | 'W' = firstColor === 'B' ? 'W' : 'B';

    let step = 0;
    let current: OgsPuzzleBranch | null = branch;

    while (current) {
      if (current.x !== undefined && current.y !== undefined && current.x >= 0 && current.y >= 0) {
        const color = step % 2 === 0 ? firstColor : opponentColor;
        moves.push({
          color,
          coord: this.xyToSgfCoord(current.x, current.y),
        });
        step++;
      }

      // 沿主链前进：取第一个子分支
      if (current.branches && current.branches.length > 0) {
        current = current.branches[0]!;
      } else {
        current = null;
      }
    }

    return moves;
  }

  // ─── 工具方法 ──────────────────────────────────────────────

  /**
   * OGS 坐标 (x, y, 0-based) 转 SGF 坐标
   * OGS 和 SGF 都是 (0,0) = 左上角，直接转字母
   */
  private xyToSgfCoord(x: number, y: number): string {
    return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
  }

  /**
   * 从 initial_state 字符串提取棋子坐标
   * 格式: "ijjikj" → ["ij", "ji", "kj"]
   */
  private extractInitialStateStones(stonesStr?: string): string[] {
    if (!stonesStr) return [];
    const stones: string[] = [];
    for (let i = 0; i + 1 < stonesStr.length; i += 2) {
      stones.push(stonesStr.substring(i, i + 2));
    }
    return stones;
  }

  /**
   * 格式化难度等级
   * OGS puzzle rank: 0 = beginner, <30 = kyu, >=30 = dan
   */
  private formatRank(rank?: number): string {
    if (rank === undefined || rank === null) return '';
    if (rank === 0) return 'Beginner';
    if (rank < 30) return Math.floor(30 - rank) + 'k';
    return Math.floor(rank - 29) + 'd';
  }

  private parseDetail(data: string): OgsPuzzleDetail | null {
    try {
      const obj = JSON.parse(data);
      if (!obj.id || !obj.puzzle) return null;
      return obj as OgsPuzzleDetail;
    } catch {
      return null;
    }
  }

  private parseListResponse(data: string): OgsPuzzleListResponse {
    try {
      const obj = JSON.parse(data);
      return {
        count: obj.count || 0,
        next: obj.next || null,
        results: (obj.results || []) as OgsPuzzleListItem[],
      };
    } catch {
      return { count: 0, next: null, results: [] };
    }
  }

  private buildMetadata(detail: OgsPuzzleDetail, puzzleId: string): GameMetadata {
    const puzzle = detail.puzzle;
    const typeName = detail.type || 'puzzle';
    const rankStr = this.formatRank(detail.rank);
    const isWhiteFirst = puzzle.initial_player === 'white';

    // 统计主分支手数
    const moveTree = puzzle.move_tree;
    const totalMoves =
      moveTree.branches && moveTree.branches.length > 0
        ? this.countMovesInBranch(moveTree.branches[0]!)
        : 0;

    return {
      source: this.name,
      gameId: puzzleId,
      blackName: isWhiteFirst ? 'White' : puzzle.name || 'OGS-' + puzzleId,
      whiteName: isWhiteFirst ? puzzle.name || 'OGS-' + puzzleId : 'OGS ' + typeName + ' ' + rankStr,
      blackRank: isWhiteFirst ? '' : rankStr,
      whiteRank: isWhiteFirst ? rankStr : '',
      width: puzzle.width,
      height: puzzle.height,
      komi: 0,
      handicap: 0,
      rules: '',
      date: (detail.modified || detail.created || '').slice(0, 10),
      result: '',
      movesCount: totalMoves,
    };
  }

  /**
   * 递归计算分支中的手数（沿主链）
   */
  private countMovesInBranch(branch: OgsPuzzleBranch): number {
    let count = 0;
    let current: OgsPuzzleBranch | null = branch;
    while (current) {
      if (current.x !== undefined && current.y !== undefined && current.x >= 0) {
        count++;
      }
      if (current.branches && current.branches.length > 0) {
        current = current.branches[0]!;
      } else {
        current = null;
      }
    }
    return count;
  }
}
