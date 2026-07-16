/**
 * @fileoverview izis围棋数据解析器
 */

import { HtmlParserBase } from '../../../../infrastructure/utils/html';
import type { GameMetadata } from '../base/types';

/**
 * izis数据解析器
 */
class IzisParser extends HtmlParserBase {
  /**
   * 从 HTML 中提取 SGF 数据
   * 支持两种格式：
   * 1. 内嵌 SGF：sgf: "(;CA[...]SZ[19]...)"
   * 2. API 引用：通过 WebGetSGFServlet 获取
   */
  extractSgfFromHtml(html: string): string | null {
    // 尝试提取内嵌 SGF（非直播分享页面）
    const sgfMatch = html.match(/sgf\s*:\s*["'](\(;[\s\S]*?\))["']/);
    if (sgfMatch && sgfMatch[1]) {
      return sgfMatch[1].trim();
    }

    // 尝试从 script 标签中提取 SGF 变量赋值
    const varMatch = html.match(/var\s+sgf\s*=\s*["'](\(;[\s\S]*?\))["']/);
    if (varMatch && varMatch[1]) {
      return varMatch[1].trim();
    }

    return null;
  }

  /**
   * 解析 SGF 中的元数据
   */
  parseSgfMetadata(sgf: string, gameId: string): GameMetadata {
    const extractTag = (tag: string): string => {
      const match = sgf.match(new RegExp(`${tag}\\[([^\\]]*)\\]`));
      return match && match[1] !== undefined ? match[1] : '';
    };

    const boardSize = parseInt(extractTag('SZ'), 10) || 19;
    const result = extractTag('RE');
    const resultStr = result || '';

    // 计算手数
    const moveMatches = sgf.match(/;[BW]\[[a-z]{0,2}\]/g);
    const movesCount = moveMatches ? moveMatches.length : 0;

    return {
      source: 'izis-archive',
      gameId,
      blackName: extractTag('PB') || '黑棋',
      whiteName: extractTag('PW') || '白棋',
      blackRank: extractTag('BR'),
      whiteRank: extractTag('WR'),
      width: boardSize,
      height: boardSize,
      komi: 6.5,
      handicap: 0,
      rules: 'chinese',
      date: '',
      result: resultStr,
      movesCount,
    };
  }

  /**
   * 解析玩家名称和段位
   */
  parsePlayerName(nameStr: string): { name: string; rank: string } {
    const match = nameStr.match(/(.+?)\s*,\s*(.+)/);
    if (match && match[1] && match[2]) {
      return { name: match[1].trim(), rank: this.formatRank(match[2].trim()) };
    }
    return { name: nameStr, rank: '' };
  }

  /**
   * 格式化段位
   */
  formatRank(rank: string): string {
    rank = rank.toLowerCase();
    if (rank.includes('k')) return rank.replace('k', '级');
    if (rank.includes('d')) return rank.replace('d', '段');
    return rank;
  }

  /**
   * 解析对局结果
   */
  parseResult(resultStr: string): string {
    const map: Record<string, string> = {
      '白胜': 'W+R',
      '黑胜': 'B+R',
      '白中盘胜': 'W+R',
      '黑中盘胜': 'B+R',
      '和棋': 'Draw',
    };
    return map[resultStr] || resultStr;
  }

  /**
   * 解析着法
   * 格式: +xxxx -xxxx +xxxx
   */
  parseMoves(allstep: string, boardSize: number): Array<[string, string]> {
    const moves: Array<[string, string]> = [];
    const matches = this.matchAll(allstep, /([+-])(\d{4})/g);

    for (const match of matches) {
      const color = match[1];
      const coord = match[2];

      if (color && coord) {
        const x = parseInt(coord.slice(0, 2), 10) - 1;
        const y = parseInt(coord.slice(2), 10) - 1;

        if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
          const sgfX = String.fromCharCode(97 + y);
          const sgfY = String.fromCharCode(97 + (boardSize - 1 - x));
          moves.push([color === '+' ? 'B' : 'W', sgfX + sgfY]);
        }
      }
    }

    return moves;
  }

  /**
   * 构建元数据
   */
  buildMetadata(data: any, gameId: string): GameMetadata {
    const blackInfo = this.parsePlayerName(data.blackname || '黑棋');
    const whiteInfo = this.parsePlayerName(data.whitename || '白棋');

    return {
      source: 'izis',
      gameId,
      blackName: blackInfo.name,
      whiteName: whiteInfo.name,
      blackRank: blackInfo.rank,
      whiteRank: whiteInfo.rank,
      width: parseInt(data.f_roomnum, 10) || 19,
      height: parseInt(data.f_roomnum, 10) || 19,
      komi: 6.5,
      handicap: 0,
      rules: 'chinese',
      date: '',
      result: this.parseResult(data.f_result || ''),
      movesCount: parseInt(data.f_num, 10) || 0,
    };
  }

  /**
   * 生成 SGF
   */
  generateSgf(metadata: GameMetadata, moves: Array<[string, string]>): string {
    const parts: string[] = [];

    parts.push("(;GM[1]FF[4]CA[UTF-8]");
    parts.push("AP[隐智智能棋盘]");
    parts.push(`SZ[${metadata.width}]`);
    parts.push(`PB[${metadata.blackName}]`);
    parts.push(`PW[${metadata.whiteName}]`);

    if (metadata.blackRank) parts.push(`BR[${metadata.blackRank}]`);
    if (metadata.whiteRank) parts.push(`WR[${metadata.whiteRank}]`);
    if (metadata.result) parts.push(`RE[${metadata.result}]`);

    parts.push("RU[Chinese]");

    for (const [color, coord] of moves) {
      parts.push(`;${color}[${coord}]`);
    }

    parts.push(")");
    return parts.join('');
  }
}

export { IzisParser };