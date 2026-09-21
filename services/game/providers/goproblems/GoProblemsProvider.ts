/**
 * @fileoverview goproblems.com 提供者实现
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming, GameMetadata } from '../base/types';
import type { IGoProblemsProvider } from './IGoProblemsProvider';
import { buildTsumegoMinBoard } from '../../../../domain/sgf';
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
   * 用正则提取关键信息，不需要完整解析 SGF 树。
   */
  private convertTo101Format(sgf: string, detail: GoProblemsProblemDetail): string {
    try {
      const boardSize = this.extractBoardSize(sgf);
      const blackStones = this.extractStones(sgf, 'AB');
      const whiteStones = this.extractStones(sgf, 'AW');
      const isWhiteFirst = this.resolveWhiteFirst(detail);

      // 解析 SGF 树，提取所有答案分支
      const tree = this.parseSgf(sgf);
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

  // ─── SGF 解析器 ────────────────────────────────────────────

  /**
   * 解析 SGF 为树结构
   *
   * SGF 格式：(;PROPERTIES(;BRANCH1...)(;BRANCH2...))
   * 每个分支内：;B[xx];W[yy];B[zz]... 是串行着法，子分支用 (...) 嵌套
   *
   * 树节点结构：
   * - properties: 当前节点的 SGF 属性
   * - color/coord: 如果是着法节点（B/W 属性）
   * - next: 同一分支内的下一个节点（串行着法）
   * - children: 分叉的子分支
   */
  private parseSgf(sgf: string): SgfNode {
    const tokens = this.tokenize(sgf);
    let pos = 0;

    // 跳过开头的 (
    if (pos < tokens.length && tokens[pos] === '(') pos++;
    const node = this.parseSequence(tokens, pos);
    return node;
  }

  /**
   * 解析一个节点序列（分支内）
   * 格式：;PROPERTIES ;PROPERTIES (...) (...)
   * 第一个 ; 开始一个节点，后续的 ; 是 next 节点，() 是子分支
   */
  private parseSequence(tokens: string[], startPos: number): SgfNode {
    let pos = startPos;
    let firstNode: SgfNode | null = null;
    let currentNode: SgfNode | null = null;

    while (pos < tokens.length && tokens[pos] !== ')') {
      if (tokens[pos] === '(') {
        // 子分支
        pos++; // 跳过 (
        const child = this.parseSequence(tokens, pos);
        if (currentNode) {
          currentNode.children.push(child);
        }
        // 找到匹配的 )
        pos = this.findClosingParen(tokens, pos - 1);
        if (pos < tokens.length && tokens[pos] === ')') pos++;
        continue;
      }

      if (tokens[pos] === ';') {
        pos++; // 跳过 ;
        const node = this.parseNodeProperties(tokens, pos);
        // 更新 pos 到节点属性之后
        pos = node.endPos;

        if (!firstNode) {
          firstNode = node.node;
          currentNode = node.node;
        } else {
          currentNode!.next = node.node;
          currentNode = node.node;
        }
        continue;
      }

      pos++;
    }

    return firstNode ?? { properties: {}, color: null, coord: '', children: [], next: null };
  }

  /**
   * 解析单个节点的属性（; 到下一个 ; 或 ( 或 ) 之间）
   */
  private parseNodeProperties(tokens: string[], startPos: number): { node: SgfNode; endPos: number } {
    let pos = startPos;
    const properties: Record<string, string[]> = {};
    let color: 'B' | 'W' | null = null;
    let coord = '';

    while (pos < tokens.length && tokens[pos] !== ';' && tokens[pos] !== '(' && tokens[pos] !== ')') {
      const tok = tokens[pos]!;
      if (tok.startsWith('[')) {
        // 值属于最近的属性名
        const keys = Object.keys(properties);
        const lastKey = keys.length > 0 ? keys[keys.length - 1]! : null;
        if (lastKey) {
          properties[lastKey]!.push(tok.slice(1, -1));
          if (lastKey === 'B' || lastKey === 'W') {
            color = lastKey as 'B' | 'W';
            coord = tok.slice(1, -1);
          }
        }
        pos++;
      } else {
        // 属性名
        properties[tok] = [];
        pos++;
      }
    }

    return {
      node: { properties, color, coord, children: [], next: null },
      endPos: pos,
    };
  }

  /**
   * 找匹配的 )
   */
  private findClosingParen(tokens: string[], openPos: number): number {
    let depth = 1;
    let pos = openPos + 1;
    while (pos < tokens.length && depth > 0) {
      if (tokens[pos] === '(') depth++;
      if (tokens[pos] === ')') depth--;
      if (depth === 0) return pos;
      pos++;
    }
    return pos;
  }

  /**
   * SGF 词法分析
   */
  private tokenize(sgf: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < sgf.length) {
      const ch = sgf[i]!;
      if (ch === '(' || ch === ')') {
        tokens.push(ch);
        i++;
      } else if (ch === ';') {
        tokens.push(';');
        i++;
      } else if (ch === '[') {
        let val = '';
        i++;
        while (i < sgf.length && sgf[i] !== ']') {
          if (sgf[i] === '\\') {
            i++;
            val += sgf[i] ?? '';
          } else {
            val += sgf[i] ?? '';
          }
          i++;
        }
        i++;
        tokens.push('[' + val + ']');
      } else if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
        i++;
      } else if (/[A-Z]/.test(ch)) {
        let prop = '';
        while (i < sgf.length && /[A-Z]/.test(sgf[i]!)) {
          prop += sgf[i];
          i++;
        }
        if (prop) tokens.push(prop);
      } else {
        i++;
      }
    }
    return tokens;
  }

  // ─── 分支提取 ──────────────────────────────────────────────

  /**
   * 从解析树中提取所有答案分支
   *
   * 根节点的 next 链是主分支（着法序列）。
   * 每当 next 链上某个节点有 children 时，每个 child 是一个分支。
   *
   * 对于死活题，我们需要收集根节点的直接子分支。
   * 每个分支：沿 next 链收集着法 + 递归查找类型注释。
   */
  private extractBranches(root: SgfNode): Array<{
    typeName: string;
    moves: Array<{ color: 'B' | 'W'; coord: string }>;
  }> {
    const branches: Array<{
      typeName: string;
      moves: Array<{ color: 'B' | 'W'; coord: string }>;
    }> = [];

    // 根节点本身可能有着法（主分支），也可能直接分叉
    // 对于 goproblems，根节点通常只有 AB/AW，没有着法
    // 分支从 root.children 开始

    if (root.children.length === 0 && root.next) {
      // 主分支有着法但无分叉 —— 整个就是一个分支
      const typeName = this.findBranchType(root.next);
      const moves = this.collectMoves(root.next);
      branches.push({ typeName, moves });
    }

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
  private findBranchType(node: SgfNode): string {
    const tags = this.collectBranchTags(node);
    if (tags.right) return '正解图';
    if (tags.notthis) return '失败图';
    if (tags.choice) return '变化图';
    return '变化图';
  }

  /**
   * 递归收集子树中所有注释标记
   */
  private collectBranchTags(node: SgfNode): { right: boolean; notthis: boolean; choice: boolean } {
    let right = false;
    let notthis = false;
    let choice = false;

    // 检查当前节点注释
    const comment = node.properties['C']?.[0] || '';
    if (comment) {
      if (comment.includes('RIGHT')) right = true;
      if (comment.includes('NOTTHIS')) notthis = true;
      if (comment.includes('CHOICE')) choice = true;
    }

    // 检查 next 链
    if (node.next) {
      const childTags = this.collectBranchTags(node.next);
      right = right || childTags.right;
      notthis = notthis || childTags.notthis;
      choice = choice || childTags.choice;
    }

    // 检查子分支
    for (const child of node.children) {
      const childTags = this.collectBranchTags(child);
      right = right || childTags.right;
      notthis = notthis || childTags.notthis;
      choice = choice || childTags.choice;
    }

    return { right, notthis, choice };
  }

  /**
   * 沿 next 链收集着法序列
   * 遇到分叉时取第一个子分支（主分支链）
   */
  private collectMoves(node: SgfNode): Array<{ color: 'B' | 'W'; coord: string }> {
    const moves: Array<{ color: 'B' | 'W'; coord: string }> = [];

    let current: SgfNode | null = node;
    while (current) {
      if (current.color && current.coord && current.coord !== 'tt' && current.coord !== 'TT') {
        moves.push({ color: current.color, coord: current.coord });
      }
      // 沿主链前进
      if (current.next) {
        current = current.next;
      } else if (current.children.length > 0) {
        // 无 next 但有子分支，取第一个子分支
        current = current.children[0]!;
      } else {
        current = null;
      }
    }

    return moves;
  }

  // ─── 工具方法 ──────────────────────────────────────────────

  private extractBoardSize(sgf: string): number {
    const match = sgf.match(/SZ\[(\d+)\]/);
    return match ? parseInt(match[1]!, 10) : 19;
  }

  /**
   * 从 SGF 根节点解析 PL[] 属性
   * goproblems 的 SGF 通常在根节点标记 PL[W] 或 PL[B]
   */
  private extractPlayerColor(sgf: string): 'white' | 'black' | null {
    // 只匹配根节点区域（第一个分支开始之前的部分）
    // 避免匹配到分支内的 PL[]
    const rootEnd = sgf.indexOf(')(');
    const rootSection = rootEnd > 0 ? sgf.substring(0, rootEnd) : sgf;
    const match = rootSection.match(/PL\[([WB])\]/);
    if (match) {
      return match[1] === 'W' ? 'white' : 'black';
    }
    return null;
  }

  /**
   * 综合判断白方是否先行
   * 优先使用 API 返回的 playerColor，为空时从 SGF 的 PL[] 属性解析
   */
  private resolveWhiteFirst(detail: GoProblemsProblemDetail): boolean {
    if (detail.playerColor === 'white') return true;
    if (detail.playerColor === 'black') return false;
    // API 未返回 playerColor 时，从 SGF 解析 PL[] 属性
    if (detail.sgf) {
      const plColor = this.extractPlayerColor(detail.sgf);
      return plColor === 'white';
    }
    return false;
  }

  private extractStones(sgf: string, color: 'AB' | 'AW'): string[] {
    const stones: string[] = [];
    // 匹配 AB[pos1][pos2]... 或 AB[pos1]AB[pos2]...
    const regex = new RegExp(color + '((?:\\[[^\\]]+\\])+)', 'g');
    let match;
    while ((match = regex.exec(sgf)) !== null) {
      const inner = match[1]!;
      const coords = inner.match(/\[([^\]]+)\]/g);
      if (coords) {
        for (const c of coords) {
          stones.push(c.slice(1, -1));
        }
      }
    }
    return stones;
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
    const moveCount = (detail.sgf.match(/;[BW]\[[a-z]{2}\]/g) || []).length;
    const boardSize = this.extractBoardSize(detail.sgf);

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

  private rankToString(rank?: GoProblemsRank | null): string {
    if (!rank) return 'Unknown';
    return rank.value + ' ' + rank.unit;
  }
}

/** SGF 树节点（内部类型） */
interface SgfNode {
  properties: Record<string, string[]>;
  color: 'B' | 'W' | null;
  coord: string;
  children: SgfNode[];
  next: SgfNode | null;
}
