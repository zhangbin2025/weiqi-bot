/**
 * @fileoverview 101围棋网解析辅助类
 */

import { HtmlParserBase } from '../../../../infrastructure/utils/html';
import type { GameMetadata } from '../base/types';
import type { Weiqi101PlayInfo, Weiqi101InitData } from './types';

/**
 * 题目数据结构
 */
export interface Weiqi101QuestionData {
  qid: number;
  publicid: number;
  name: string;
  levelname: string;
  min_levelname?: string;
  max_levelname?: string;
  qtypename: string;
  blackfirst: boolean;
  content: [string[], string[]]; // [黑子, 白子]
  answers: Array<{
    pts: Array<{ p: string }>;
    st: number; // 0=失败, 1=变招, 2=正解（答案结果状态）
    ty: number; // 1=正解图, 2=变化图, 3=失败图（图的分类）
    nu?: number; // 序号（全局排序）
    username?: string;
  }>;
  lu: number;
  daotiemu?: number;
  rangzi?: number;
  status?: number;
  username?: string;
  userid?: number;
  vote?: number;
  yes_count?: number;
  no_count?: number;
}

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
   * 从 HTML 提取题目数据
   */
  extractQuestionData(html: string): Weiqi101QuestionData | null {
    // 匹配 var qqdata = {...};
    const match = html.match(/var\s+qqdata\s*=\s*(\{.+?\});/s);
    if (!match || !match[1]) {
      return null;
    }

    try {
      // 使用 Function 构造器解析 JSON（处理非标准JSON）
      const parseFn = new Function('return ' + match[1]);
      const qqdata = parseFn();

      // 验证必要字段
      if (!qqdata.qid || !qqdata.content) {
        return null;
      }

      // 解密加密字段（如果需要）
      this.decryptQQData(qqdata);

      // 验证解密后的数据
      if (!Array.isArray(qqdata.content)) {
        return null;
      }

      return {
        qid: qqdata.qid,
        publicid: qqdata.publicid,
        name: qqdata.name || '',
        levelname: qqdata.levelname || '',
        min_levelname: qqdata.min_levelname,
        max_levelname: qqdata.max_levelname,
        qtypename: qqdata.qtypename || '死活题',
        blackfirst: qqdata.blackfirst ?? true,
        content: qqdata.content,
        answers: (qqdata.answers || []).map((a: any) => ({
          ...a,
          st: a.st ?? 0,
          ty: a.ty ?? 1,
          nu: a.nu,
          username: a.username,
          pts: a.pts || [],
        })),
        lu: qqdata.lu || 19,
        daotiemu: qqdata.daotiemu,
        rangzi: qqdata.rangzi,
        status: qqdata.status,
        username: qqdata.username,
        userid: qqdata.userid,
        vote: qqdata.vote,
        yes_count: qqdata.yes_count,
        no_count: qqdata.no_count,
      };
    } catch {
      return null;
    }
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
        result = 'B+' + score.toFixed(1);
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

  /**
   * 解密加密字段
   */
  private decryptQQData(qqdata: any): void {
    if (!qqdata.ru || qqdata.ru < 1 || qqdata.ru > 2) {
      return; // 无需解密
    }

    // 计算密钥
    const i = String(qqdata.ru + 1);
    const e = '101';
    const s = e + i + i;
    const key = s + i; // 101222 或 101333

    // 需要解密的字段
    const encryptedFields = [
      'content',
      'ok_answers',
      'change_answers',
      'fail_answers',
      'clone_pos',
      'clone_prepos',
    ];

    for (const field of encryptedFields) {
      if (qqdata[field] && typeof qqdata[field] === 'string') {
        try {
          const decrypted = this.xorDecrypt(qqdata[field], key);
          qqdata[field] = JSON.parse(decrypted);
        } catch {
          // 解密失败，保持原样
        }
      }
    }
  }

  /**
   * XOR 解密
   */
  private xorDecrypt(encryptedBase64: string, key: string): string {
    // Base64 解码
    const encrypted = atob(encryptedBase64);
    // XOR 解密
    let decrypted = '';
    for (let i = 0; i < encrypted.length; i++) {
      const keyByte = key.charCodeAt(i % key.length);
      decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ keyByte);
    }
    return decrypted;
  }
}

export { Weiqi101Parser };
