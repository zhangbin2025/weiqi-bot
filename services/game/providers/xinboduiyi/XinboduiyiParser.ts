/**
 * @fileoverview 新博对弈数据解析器
 */

import { HtmlParserBase } from '../../../../infrastructure/utils/html';
import type { GameMetadata } from '../base/types';
import type { XinboduiyiGameData } from './types';

/**
 * 新博对弈数据解析器
 */
class XinboduiyiParser extends HtmlParserBase {
  /**
   * 构建元数据
   */
  buildMetadata(data: XinboduiyiGameData, gameId: string): GameMetadata {
    return {
      source: 'xinboduiyi',
      gameId: gameId.replace('/', '_'),
      blackName: data.BlackAliasName || '黑方',
      whiteName: data.WhiteAliasName || '白方',
      blackRank: '',
      whiteRank: '',
      width: data.BoardSize || 19,
      height: data.BoardSize || 19,
      komi: data.komi_value || 7.5,
      handicap: 0,
      rules: 'chinese',
      date: '',
      result: this.parseResult(data.ResultCode, data.resultType),
      movesCount: this.countMoves(data),
    };
  }

  /**
   * 解析对局结果
   */
  parseResult(resultCode?: number, resultType?: number): string {
    if (resultCode === 0 || resultCode === undefined) return '';

    const winner = resultCode === 1 ? 'B' : 'W';
    const typeMap: Record<number, string> = {
      1: '+R', 2: '+', 3: '+T', 4: '+R',
    };

    return `${winner}${typeMap[resultType || 1]}`;
  }

  /**
   * 解析着法
   */
  parseMoves(data: XinboduiyiGameData): Array<[string, string]> {
    const moves: Array<[string, string]> = [];

    let sgfStr = '';
    const partQipu = data.part_qipu || [];
    let hasPart0Data = false;
    
    for (const part of partQipu) {
      if (part.part_id === 0 && part.latest_full_qipu) {
        sgfStr = part.latest_full_qipu;
        hasPart0Data = true;
        break;
      }
    }

    if (!sgfStr) sgfStr = data.StepStr || '';
    if (!sgfStr) return moves;

    // 关键：只有当 part_id=0 真正有数据时才旋转
    // 如果回退到 StepStr，则不旋转
    const needRotation = hasPart0Data;

    const matches = this.matchAll(sgfStr, /([BW])\[([A-Z]{2})\]/g);

    for (const match of matches) {
      const color = match[1];
      const coord = match[2];
      if (color && coord) {
        const sgfCoord = this.convertCoord(coord, needRotation);
        if (sgfCoord) moves.push([color, sgfCoord]);
      }
    }

    return moves;
  }

  /**
   * 新博坐标转换
   */
  convertCoord(coord: string, rotate: boolean): string | null {
    if (coord.length !== 2) return null;

    const c1 = coord[0]?.toUpperCase();
    const c2 = coord[1]?.toUpperCase();

    if (!c1 || !c2) return null;

    const vertMap: Record<string, string> = {
      'A': 'a', 'B': 'b', 'C': 'c', 'D': 'd', 'E': 'e',
      'F': 'f', 'G': 'g', 'H': 'h', 'J': 'i', 'K': 'j',
      'L': 'k', 'M': 'l', 'N': 'm', 'O': 'n', 'P': 'o',
      'Q': 'p', 'R': 'q', 'S': 'r', 'T': 's',
    };

    const horizMap: Record<string, string> = {
      'T': 'a', 'S': 'b', 'R': 'c', 'Q': 'd', 'P': 'e',
      'O': 'f', 'N': 'g', 'M': 'h', 'L': 'i', 'K': 'j',
      'J': 'k', 'H': 'l', 'G': 'm', 'F': 'n', 'E': 'o',
      'D': 'p', 'C': 'q', 'B': 'r', 'A': 's',
    };

    const sgfY = vertMap[c1];
    const sgfX = horizMap[c2];

    if (!sgfX || !sgfY) return null;

    const origX = sgfX.charCodeAt(0) - 97;
    const origY = sgfY.charCodeAt(0) - 97;

    if (rotate) {
      const newX = origY;
      const newY = 18 - origX;
      return String.fromCharCode(97 + newX) + String.fromCharCode(97 + newY);
    }

    return sgfX + sgfY;
  }

  /**
   * 统计着法数
   */
  countMoves(data: XinboduiyiGameData): number {
    return this.parseMoves(data).length;
  }

  /**
   * 生成 SGF
   */
  generateSgf(metadata: GameMetadata, moves: Array<[string, string]>): string {
    const parts: string[] = [];

    parts.push("(;GM[1]FF[4]");
    parts.push(`SZ[${metadata.width}]`);
    parts.push(`KM[${metadata.komi}]`);
    parts.push(`PB[${metadata.blackName}]`);
    parts.push(`PW[${metadata.whiteName}]`);

    if (metadata.result) parts.push(`RE[${metadata.result}]`);
    parts.push("EV[新博对弈]");

    for (const [color, coord] of moves) {
      parts.push(`;${color}[${coord}]`);
    }

    parts.push(")");
    return parts.join('\n');
  }
}

export { XinboduiyiParser };