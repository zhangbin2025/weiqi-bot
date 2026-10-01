/**
 * @fileoverview 弈城数据解析器
 */

import { HtmlParserBase } from '../../../../infrastructure/utils/html';
import { SGFWriter } from '../../../../domain/sgf';
import type { MoveOrPass } from '../../../../domain/move';

/**
 * 弈城解析器
 */
class YichengParser extends HtmlParserBase {
  private readonly sgfWriter = new SGFWriter();
  /**
   * 解析弈城格式数据
   */
  parseGameData(data: string): {
    blackName: string;
    whiteName: string;
    blackRank: string;
    whiteRank: string;
    date: string;
    moves: Array<{ color: string; x: number; y: number }>;
  } {
    const blackMatch = this.matchFirst(data, /BID:([^,]+),BLV:([^,]+),BNICK:([^,]+)/);
    const whiteMatch = this.matchFirst(data, /WID:([^,]+),WLV:([^,]+),WNICK:([^,]+)/);
    const gameMatch = this.matchFirst(data, /GDATE:([^,]+)/);

    const blackName = blackMatch?.[1] || '黑棋';
    const whiteName = whiteMatch?.[1] || '白棋';
    const blackRank = blackMatch?.[2] ? this.parseLevel(blackMatch[2]) : '';
    const whiteRank = whiteMatch?.[2] ? this.parseLevel(whiteMatch[2]) : '';
    const date = gameMatch?.[1] || '';

    const moves: Array<{ color: string; x: number; y: number }> = [];
    const moveMatches = this.matchAll(data, /STO\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/g);

    for (const match of moveMatches) {
      const color = match[2] === '1' ? 'B' : 'W';
      const x = match[3] ? parseInt(match[3], 10) : 0;
      const y = match[4] ? parseInt(match[4], 10) : 0;
      moves.push({ color, x, y });
    }

    return { blackName, whiteName, blackRank, whiteRank, date, moves };
  }

  /**
   * 解析弈城段位
   *
   * 弈城等级系统:
   * - 18-26: 职业段位 (1段=18, 9段=26)
   * - 0-17: 业余级位 (18级=0, 1级=17)
   */
  private parseLevel(levelStr: string): string {
    try {
      const level = parseInt(levelStr, 10);
      if (level >= 18) {
        const dan = level - 17;
        return `${dan}段`;
      } else {
        const kyu = 18 - level;
        return `${kyu}级`;
      }
    } catch {
      return levelStr;
    }
  }

  /**
   * 生成 SGF 内容（使用 domain/sgf 接口）
   */
  generateSgf(parsed: {
    blackName: string;
    whiteName: string;
    date: string;
    moves: Array<{ color: string; x: number; y: number }>;
  }): string {
    const moveOrPass: MoveOrPass[] = parsed.moves.map((m, i) => ({
      x: m.x,
      y: m.y,
      color: m.color === 'B' ? 'black' : 'white',
      number: i + 1,
    }));
    return this.sgfWriter.write(moveOrPass, {
      size: 19,
      blackName: parsed.blackName,
      whiteName: parsed.whiteName,
      date: parsed.date || undefined,
      komi: 6.5,
      rules: 'chinese',
      application: '弈城围棋',
    });
  }
}

// 导出单例和便捷函数
const parser = new YichengParser();

export function parseGameData(data: string): ReturnType<YichengParser['parseGameData']> {
  return parser.parseGameData(data);
}

export function generateSgf(parsed: Parameters<YichengParser['generateSgf']>[0]): string {
  return parser.generateSgf(parsed);
}

export { YichengParser };
