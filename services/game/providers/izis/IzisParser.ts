/**
 * @fileoverview izis围棋数据解析器
 */

import { HtmlParserBase } from '../../../../infrastructure/utils/html';
import type { GameMetadata } from '../base/types';
import { parseSGF, SGFWriter } from '../../../../domain/sgf';
import type { MoveOrPass } from '../../../../domain/move';

/**
 * izis数据解析器
 */
class IzisParser extends HtmlParserBase {
  private readonly sgfWriter = new SGFWriter();
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
   * 从 SGF 提取元数据（使用 domain/sgf 接口）
   */
  parseSgfMetadata(sgf: string, gameId: string): GameMetadata {
    const result = parseSGF(sgf);
    const info = result.gameInfo;
    // domain 默认 komi='375'（表示 3.75），izis 原默认 6.5
    const komiNum = parseFloat(info.komi);
    const komi = (info.komi === '375' || isNaN(komiNum)) ? 6.5 : komiNum;
    return {
      source: 'izis-archive',
      gameId,
      blackName: info.black || '黑棋',
      whiteName: info.white || '白棋',
      blackRank: info.blackRank || '',
      whiteRank: info.whiteRank || '',
      width: info.boardSize,
      height: info.boardSize,
      komi,
      handicap: info.handicap,
      rules: info.rules || 'chinese',
      date: info.date || '',
      result: info.result || '',
      movesCount: result.moves.length,
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
          const sgfX = String.fromCharCode(97 + y);  // 对角线翻转：交换 x/y
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
   * 生成 SGF（使用 domain/sgf 接口）
   */
  generateSgf(metadata: GameMetadata, moves: Array<[string, string]>): string {
    const moveOrPass: MoveOrPass[] = moves.map(([color, coord], i) => ({
      x: coord.charCodeAt(0) - 97,
      y: coord.charCodeAt(1) - 97,
      color: color === 'B' ? 'black' : 'white',
      number: i + 1,
    }));
    return this.sgfWriter.write(moveOrPass, {
      size: metadata.width,
      blackName: metadata.blackName,
      whiteName: metadata.whiteName,
      blackRank: metadata.blackRank || undefined,
      whiteRank: metadata.whiteRank || undefined,
      komi: metadata.komi,
      result: metadata.result || undefined,
      rules: 'chinese',
      application: '隐智智能棋盘',
    });
  }
}

export { IzisParser };