/**
 * @fileoverview goproblems.com 提供者实现
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming, GameMetadata } from '../base/types';
import type { IGoProblemsProvider } from './IGoProblemsProvider';
import { buildTsumegoMinBoard, parseSGF } from '../../../../domain/sgf';
import type { ISGFNode, ISGFParseResult, SGFPropValue } from '../../../../domain/sgf';
import type {
  GoProblemsProblemDetail,
  GoProblemsListItem,
  GoProblemsRank,
} from './types';

/** goproblems.com 基础 URL */
const GOPROBLEMS_BASE_URL = 'https://goproblems.com';

/** API 基础 URL */
const GOPROBLEMS_API_URL = 'https://goproblems.com/api/v2';

/** goproblems 注释到 101 围棋分支类型映射 */
const COMMENT_TYPE_MAP: Record<string, string> = {
  RIGHT: '正解图',
  CHOICE: '变化图',
  NOTTHIS: '失败图',
};

/**
 * 将 SGFPropValue (string | string[]) 转为 string[]
 */
function propList(raw: SGFPropValue | undefined): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

/** 从节点属性中取第一个值 */
function propFirst(raw: SGFPropValue | undefined): string {
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return raw[0] ?? '';
  return String(raw);
}

/** 答案分支 */
interface AnswerBranch {
  typeName: string;
  moves: Array<{ color: 'B' | 'W'; coord: string }>;
}

/**
 * goproblems.com 提供者
 *
 * 通过 REST API 获取死活题数据和 SGF 内容。
 * API 无需鉴权，直接返回完整 SGF（含正解/变化/失败分支）。
 *
 * SGF 格式转换：
 * goproblems 的 SGF 分支注释（RIGHT/CHOICE/NOTTHIS）在深层节点上，
 * 转换为 101 围棋格式（正解图/变化图/失败图注释在分支首节点上），
 * 使 replay 页面的死活题处理逻辑无需修改。
 */
export class GoProblemsProvider extends BaseProvider implements IGoProblemsProvider {
  readonly name = 'goproblems';
  readonly displayName = 'GoProblems';
  readonly urlPatterns = [
    /goproblems\.com\/(\d+)/,
    /goproblems\.com\/problems\/(\d+)/,
  ];

  async fetchById(problemId: string): Promise<FetchResult> {
    const url = GOPROBLEMS_BASE_URL + '/problems/' + problemId;
    return this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const problemId = this.extractId(url);
    if (!problemId) {
      return this.createErrorResult(url, '无法从 URL 提取题目 ID', timing);
    }

    try {
      const apiStart = this.now();
      const apiUrl = GOPROBLEMS_API_URL + '/problems/' + problemId;

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

      if (!detail.sgf) {
        return this.createErrorResult(url, '题目未包含 SGF 数据', timing);
      }

      const convertedRaw = this.convertTo101Format(detail.sgf, detail);
      // 死活题：抓取即转换为最小标准路数小棋盘，归档即小棋盘（非局部题自动回退原 SGF）
      const minBoard = buildTsumegoMinBoard(convertedRaw);
      const convertedSgf = minBoard ? minBoard.sgf : convertedRaw;
      const metadata = this.buildMetadata(detail, problemId);
      if (minBoard) {
        metadata.width = minBoard.size;
        metadata.height = minBoard.size;
      }

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent: convertedSgf,
        metadata,
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        '下载失败: ' + (error instanceof Error ? error.message : String(error)),
        timing,
      );
    }
  }

  async fetchProblemList(
    count?: number,
    keyword?: string,
  ): Promise<Array<{ title: string; subtitle: string; date: string; url: string }>> {
    const maxCount = count ?? 20;
    const kw = keyword?.trim().toLowerCase() || '';
    const results: Array<{ title: string; subtitle: string; date: string; url: string }> = [];

    try {
      // 网页端用 POST /api/problems/ + criteria 获取列表
      // /api/v2/problems?offset=0 有缓存延迟，缺少最新题目
      const perPage = 30;
      let offset = 0;

      while (results.length < maxCount) {
        const limit = Math.min(perPage, maxCount - results.length);
        const apiUrl = 'https://goproblems.com/api/problems/';

        const response = await this.network.request<string>({
          url: apiUrl,
          method: 'POST',
          responseType: 'text',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
            Accept: 'application/json',
          },
          data: {
            criteria: {
              offset,
              limit,
              sortBy: 'id',
              sortDirection: 'desc',
            },
          },
        });

        const entries = this.parseListResponse(response.data);
        if (entries.length === 0) break;

        for (const item of entries) {
          if (results.length >= maxCount) break;

          const rankStr = item.difficulty || (item.rank ? this.rankToString(item.rank) : '');
          const genre = item.genre || '';
          const dateStr = (item.createdAt || '').slice(0, 10);
          const authorName = item.author?.name || '';
          const authorRank = item.author?.rank ? this.rankToString(item.author.rank) : '';

          if (kw) {
            const matchRank = rankStr.toLowerCase().includes(kw);
            const matchGenre = genre.toLowerCase().includes(kw);
            const matchId = String(item.id).includes(kw);
            const matchDate = dateStr.toLowerCase().includes(kw);
            const matchAuthor = authorName.toLowerCase().includes(kw);
            if (!matchRank && !matchGenre && !matchId && !matchDate && !matchAuthor) continue;
          }

          const subtitleParts = [rankStr, genre, authorName && (authorName + (authorRank ? '(' + authorRank + ')' : ''))].filter(Boolean);
          results.push({
            title: 'GP-' + item.id,
            subtitle: subtitleParts.join(' '),
            date: dateStr,
            url: GOPROBLEMS_BASE_URL + '/problems/' + item.id,
          });
        }

        if (entries.length < limit) break;

        offset += limit;
        if (offset >= perPage * 10) break;
      }
    } catch (error) {
      console.error('[GoProblemsProvider] fetchProblemList failed:', error);
    }

    return results;
  }

  // ─── SGF 格式转换 ──────────────────────────────────────────

  /**
   * 将 goproblems SGF 转换为 101 围棋格式
   *
   * 转换规则：
   * 1. 根节点保留 AB/AW 初始棋子
   * 2. 每个顶层分支：
   *    - 递归查找深层注释 RIGHT/CHOICE/NOTTHIS → 正解图/变化图/失败图
   *    - 注释放在分支首节点（101 格式）
   *    - 着法序列平铺为 ;B[xx];W[yy]...
   * 3. 按类型排序：正解图 → 变化图 → 失败图
   *
   * 使用 domain/sgf 的 parseSGF() 解析 SGF，goproblems 特有的分支分类逻辑保留。
   */
  private convertTo101Format(sgf: string, detail: GoProblemsProblemDetail): string {
    try {
      const parseResult = parseSGF(sgf);
      const tree = parseResult.tree;
      const boardSize = parseResult.gameInfo.boardSize;
      const blackStones = propList(tree.properties['AB']);
      const whiteStones = propList(tree.properties['AW']);
      const isWhiteFirst = this.resolveWhiteFirst(detail, parseResult);

      // 从解析树中提取所有答案分支
      const branches = this.extractBranches(tree);

      // 排序：正解图 → 变化图 → 失败图
      const typeOrder: Record<string, number> = { '正解图': 0, '变化图': 1, '失败图': 2 };
      branches.sort((a, b) => (typeOrder[a.typeName] ?? 99) - (typeOrder[b.typeName] ?? 99));

      // 构建 101 格式 SGF
      const parts: string[] = [];
      parts.push('(;GM[1]FF[4]CA[UTF-8]');
      parts.push('SZ[' + boardSize + ']');

      const authorName = detail.author?.name || 'GoProblems';
      const rankStr = this.rankToString(detail.rank);
      parts.push('PB[' + (isWhiteFirst ? 'White' : authorName) + ']');
      parts.push('PW[' + (isWhiteFirst ? authorName : 'GoProblems ' + rankStr) + ']');

      const desc = 'GP-' + detail.id + ' - ' + rankStr + ' ' + (detail.genre || '') + ' - ' + (isWhiteFirst ? '白先' : '黑先');
      parts.push('C[' + desc + ']');

      if (isWhiteFirst) {
        parts.push('PL[W]');
      }

      for (const pos of blackStones) parts.push('AB[' + pos + ']');
      for (const pos of whiteStones) parts.push('AW[' + pos + ']');

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
    } catch (e) {
      console.error('[GoProblemsProvider] SGF conversion failed:', e);
      return sgf;
    }
  }

  // ─── 分支提取（适配 ISGFNode） ──────────────────────────────

  /**
   * 从解析树中提取所有答案分支
   *
   * 对于死活题，root 的直接子节点就是各答案分支。
   * 每个分支：沿 children[0] 链收集着法 + 递归查找类型注释。
   *
   * 特殊情况：如果 root 无子分支但主链有着法，整条主链作为一个分支。
   */
  private extractBranches(root: ISGFNode): AnswerBranch[] {
    const branches: AnswerBranch[] = [];

    if (root.children.length === 0) {
      // 空树，无分支
      return branches;
    }

    // 检查 root 是否有直接着法（主分支有着法但无分叉）
    // 对于 goproblems，root 通常只有 AB/AW，没有着法
    // 分支从 root.children 开始
    for (const child of root.children) {
      const typeName = this.findBranchType(child);
      const moves = this.collectMoves(child);
      branches.push({ typeName, moves });
    }

    return branches;
  }

  /**
   * 递归查找分支中的死活题注释，返回 101 格式类型名
   *
   * 遍历整个子树，收集所有注释标记：
   * - RIGHT（正解图）优先级最高
   * - NOTTHIS（失败图）次之
   * - CHOICE（变化图）最低
   * - 都没有注释 → 变化图
   *
   * 注意：不能遇到 CHOICE 就返回，因为更深层可能有 RIGHT。
   */
  private findBranchType(node: ISGFNode): string {
    const tags = this.collectBranchTags(node);
    if (tags.right) return '正解图';
    if (tags.notthis) return '失败图';
    if (tags.choice) return '变化图';
    return '变化图';
  }

  /**
   * 递归收集子树中所有注释标记
   *
   * ISGFNode 的串行着法通过 children[0] 链接，分叉通过 children[1+] 体现。
   * 需要遍历整棵子树（所有 children）。
   */
  private collectBranchTags(node: ISGFNode): { right: boolean; notthis: boolean; choice: boolean } {
    let right = false;
    let notthis = false;
    let choice = false;

    // 检查当前节点注释
    const comment = propFirst(node.properties['C']);
    if (comment) {
      if (comment.includes('RIGHT')) right = true;
      if (comment.includes('NOTTHIS')) notthis = true;
      if (comment.includes('CHOICE')) choice = true;
    }

    // 递归检查所有子节点（包括主链 children[0] 和分支 children[1+]）
    for (const child of node.children) {
      const childTags = this.collectBranchTags(child);
      right = right || childTags.right;
      notthis = notthis || childTags.notthis;
      choice = choice || childTags.choice;
    }

    return { right, notthis, choice };
  }

  /**
   * 沿 children[0] 链收集着法序列（主分支链）
   * 遇到分叉时取第一个子分支（主分支链）
   */
  private collectMoves(node: ISGFNode): Array<{ color: 'B' | 'W'; coord: string }> {
    const moves: Array<{ color: 'B' | 'W'; coord: string }> = [];

    let current: ISGFNode | undefined = node;
    while (current) {
      if (current.color && current.coord && current.coord !== 'tt' && current.coord !== 'TT') {
        moves.push({ color: current.color, coord: current.coord });
      }
      // 沿主链前进：优先 children[0]
      current = current.children[0];
    }

    return moves;
  }

  // ─── 工具方法 ──────────────────────────────────────────────

  /**
   * 综合判断白方是否先行
   * 优先使用 API 返回的 playerColor，为空时从 parseSGF 的 gameInfo.initialPlayer 判断
   */
  private resolveWhiteFirst(detail: GoProblemsProblemDetail, parseResult?: ISGFParseResult): boolean {
    if (detail.playerColor === 'white') return true;
    if (detail.playerColor === 'black') return false;
    // API 未返回 playerColor 时，从解析结果判断
    if (parseResult) {
      return parseResult.gameInfo.initialPlayer === 'white';
    }
    // 兜底：从 SGF 解析
    if (detail.sgf) {
      const result = parseSGF(detail.sgf);
      return result.gameInfo.initialPlayer === 'white';
    }
    return false;
  }

  private parseDetail(data: string): GoProblemsProblemDetail | null {
    try {
      const obj = JSON.parse(data);
      if (!obj.id || !obj.sgf) return null;
      return obj as GoProblemsProblemDetail;
    } catch {
      return null;
    }
  }

  private parseListResponse(data: string): GoProblemsListItem[] {
    try {
      const obj = JSON.parse(data);
      // POST /api/problems/ 返回 { entries, totalRecords }
      if (obj.entries && Array.isArray(obj.entries)) {
        return obj.entries as GoProblemsListItem[];
      }
      // 兼容旧格式（直接数组）
      if (Array.isArray(obj)) return obj as GoProblemsListItem[];
      return [];
    } catch {
      return [];
    }
  }

  private buildMetadata(detail: GoProblemsProblemDetail, problemId: string): GameMetadata {
    const rankStr = this.rankToString(detail.rank);
    const authorName = detail.author?.name || 'GoProblems';
    const isWhiteFirst = this.resolveWhiteFirst(detail);
    const boardSize = this.extractBoardSizeFromSgf(detail.sgf);
    // 使用正则统计手数（metadata 需要原始 SGF 的手数，转换前的）
    const moveCount = (detail.sgf.match(/;[BW]\[[a-z]{2}\]/g) || []).length;

    return {
      source: this.name,
      gameId: problemId,
      blackName: isWhiteFirst ? 'White' : authorName,
      whiteName: isWhiteFirst ? authorName : 'GoProblems ' + rankStr,
      blackRank: isWhiteFirst ? '' : rankStr,
      whiteRank: isWhiteFirst ? rankStr : '',
      width: boardSize,
      height: boardSize,
      komi: 0,
      handicap: 0,
      rules: '',
      date: detail.createdAt || '',
      result: '',
      movesCount: moveCount,
    };
  }

  /**
   * 从 SGF 提取棋盘大小（用于 buildMetadata）
   * buildMetadata 在 convertTo101Format 之前调用，此时 SGF 还未解析
   */
  private extractBoardSizeFromSgf(sgf: string): number {
    const match = sgf.match(/SZ\[(\d+)\]/);
    return match ? parseInt(match[1]!, 10) : 19;
  }

  private rankToString(rank?: GoProblemsRank | null): string {
    if (!rank) return 'Unknown';
    return rank.value + ' ' + rank.unit;
  }
}
