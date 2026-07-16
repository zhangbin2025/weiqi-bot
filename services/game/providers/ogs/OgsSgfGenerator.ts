/**
 * @fileoverview OGS SGF 生成器
 */

import type { GameMetadata } from '../base/types';
import type { OgsGameResponse } from './types';

/**
 * OGS SGF 生成器
 *
 * 负责将 OGS API 响应转换为 SGF 格式。
 */
export class OgsSgfGenerator {
  /**
   * 生成 SGF 内容
   */
  generate(data: OgsGameResponse, metadata: GameMetadata): string {
    const parts: string[] = [];
    const gamedata = data.gamedata || {};

    // 头部
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push(`SZ[${metadata.width}:${metadata.height}]`);
    parts.push(`PB[${metadata.blackName}]`);
    parts.push(`PW[${metadata.whiteName}]`);

    if (metadata.blackRank) {
      parts.push(`BR[${metadata.blackRank}]`);
    }
    if (metadata.whiteRank) {
      parts.push(`WR[${metadata.whiteRank}]`);
    }

    parts.push(`KM[${metadata.komi}]`);

    if (metadata.date) {
      parts.push(`DT[${metadata.date}]`);
    }

    if (metadata.result) {
      parts.push(`RE[${metadata.result}]`);
    }

    if (metadata.handicap > 0) {
      parts.push(`HA[${metadata.handicap}]`);
      const handicapStones = this.getHandicapStones(
        metadata.handicap,
        metadata.width,
        metadata.height
      );
      for (const coord of handicapStones) {
        parts.push(`AB[${coord}]`);
      }
    }

    // 规则
    const ruleMap: Record<string, string> = {
      japanese: 'JP',
      chinese: 'CN',
      korean: 'KO',
      aga: 'AGA',
      ing: 'ING',
    };
    const rule = ruleMap[metadata.rules] || 'JP';
    parts.push(`RU[${rule}]`);

    // 着法
    const moves = gamedata.moves || [];
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]!;
      if (move.length >= 2) {
        const x = move[0]!;
        const y = move[1]!;
        const coord = this.coordToSgf(x, y, metadata.height);
        const color = i % 2 === 0 ? 'B' : 'W';
        parts.push(`;${color}[${coord}]`);
      }
    }

    parts.push(')');
    return parts.join('');
  }

  /**
   * OGS 坐标转 SGF 坐标
   * OGS: (0,0) = 左上角
   * SGF: (0,0) = 左下角
   */
  private coordToSgf(x: number, y: number, height: number): string {
    if (x === -1 && y === -1) {
      return ''; // pass
    }
    const sgfX = String.fromCharCode(97 + x);
    const sgfY = String.fromCharCode(97 + (height - 1 - y));
    return sgfX + sgfY;
  }

  /**
   * 获取让子位置
   */
  private getHandicapStones(
    handicap: number,
    width: number,
    height: number
  ): string[] {
    const coords: string[] = [];
    // 标准星位（仅支持 19x19）
    if (width === 19 && height === 19) {
      const starPoints = [
        [3, 3],
        [15, 15],
        [15, 3],
        [3, 15],
        [9, 9],
        [3, 9],
        [15, 9],
        [9, 3],
        [9, 15],
      ];
      for (let i = 0; i < Math.min(handicap, starPoints.length); i++) {
        const [x, y] = starPoints[i]!;
        coords.push(this.coordToSgf(x!, y!, height));
      }
    }
    return coords;
  }
}