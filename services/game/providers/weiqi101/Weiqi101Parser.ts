/**
 * @fileoverview 101围棋网解析辅助类
 */

import { HtmlParserBase } from '../../../../infrastructure/utils/html';
import type { GameMetadata } from '../base/types';
import type { Weiqi101PlayInfo, Weiqi101InitData } from './types';

/**
 * 101围棋网解析辅助类
 *
 * 负责从 HTML 和 API 响应中提取和解析数据。
 */
class Weiqi101Parser extends HtmlParserBase {
  /**
   * 从 HTML 提取 playInfo
   */
  extractPlayInfo(html: string): Weiqi101PlayInfo | null {
    // 尝试多种模式匹配
    const patterns = [
      // 模式1: var playInfo = {...}, language（JavaScript 变量格式）
      /var\s+playInfo\s*=\s*(\{.+?\})\s*,\s*language/s,
      // 模式2: playInfo: {...}, language（原始格式）
      /playInfo:\s*(\{.+?\}),\s*language/s,
      // 模式3: window.playInfo = {...}
      /window\.playInfo\s*=\s*(\{[^;]+\});/s,
    ];

    for (const pattern of patterns) {
      const match = this.matchFirst(html, pattern);
      if (match && match[1]) {
        try {
          const jsonStr = match[1].trim();
          const parseFn = new Function('return ' + jsonStr);
          return parseFn();
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  /**
   * 解析元数据
   */
  parseMetadata(
    playInfo: Weiqi101PlayInfo,
    playId: string,
    source: string,
    wsData?: Weiqi101InitData
  ): GameMetadata {
    const ruleMap: Record<number, string> = {
      1: 'chinese',
      2: 'japanese',
      3: 'korean',
    };

    const status = wsData?.status ?? playInfo.status ?? 0;
    let result = '';

    if (status === 1) {
      const wintype = playInfo.wintype || 0;
      const winnumber = playInfo.winnumber || 0;

      if (wintype === 1) {
        result = playInfo.black_first ? 'B+R' : 'W+R';
      } else if (wintype === 2 && winnumber > 0) {
        const score = winnumber / 100;
        result = `B+${score.toFixed(1)}`;
      }
    }

    return {
      source,
      gameId: String(playId),
      blackName: playInfo.busername || playInfo.black || 'Black',
      whiteName: playInfo.wusername || playInfo.white || 'White',
      blackRank: playInfo.blacklevelname || '',
      whiteRank: playInfo.whitelevelname || '',
      width: playInfo.lu || 19,
      height: playInfo.lu || 19,
      komi: playInfo.daotiemu || 7.5,
      handicap: playInfo.rangzi || 0,
      rules: ruleMap[playInfo.gamerule || 1] || 'chinese',
      date: '',
      result,
      movesCount: wsData?.stepcount ?? playInfo.step ?? 0,
    };
  }
}

export { Weiqi101Parser };
