/**
 * @fileoverview 101围棋网 SGF 生成器
 */

import type { GameMetadata } from '../base/types';

/**
 * 101围棋网 SGF 生成器
 *
 * 负责将棋谱数据转换为 SGF 格式。
 */
export class Weiqi101SgfGenerator {
  /**
   * 生成 SGF 内容（WebSocket 数据）
   */
  generate(posList: string[], metadata: GameMetadata): string {
    const parts: string[] = [];

    // 头部
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push(`SZ[${metadata.width}]`);
    parts.push(`PB[${metadata.blackName}]`);
    parts.push(`PW[${metadata.whiteName}]`);

    if (metadata.blackRank) {
      parts.push(`BR[${metadata.blackRank}]`);
    }
    if (metadata.whiteRank) {
      parts.push(`WR[${metadata.whiteRank}]`);
    }

    parts.push(`KM[${metadata.komi}]`);

    if (metadata.result) {
      parts.push(`RE[${metadata.result}]`);
    }

    // 规则
    const ruleCode = { chinese: 'CN', japanese: 'JP', korean: 'KO' }[
      metadata.rules
    ] || 'CN';
    parts.push(`RU[${ruleCode}]`);

    if (metadata.handicap > 0) {
      parts.push(`HA[${metadata.handicap}]`);
    }

    // 着法：pos 已经是 SGF 格式坐标
    for (let i = 0; i < posList.length; i++) {
      const pos = posList[i];
      if (pos === 'tt') continue; // 停一手

      const color = i % 2 === 0 ? 'B' : 'W';
      parts.push(`;${color}[${pos}]`);
    }

    parts.push(')');
    return parts.join('');
  }
}
