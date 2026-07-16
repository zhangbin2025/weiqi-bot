/**
 * @fileoverview 1919围棋 SGF 生成器
 */

import type { GameMetadata } from '../base/types';

/**
 * 1919围棋 SGF 生成器
 */
export class Weiqi1919SgfGenerator {
  /**
   * 生成 SGF 字符串
   */
  generate(coords: string[], info: any, boardSize: number): string {
    const parts: string[] = [];

    parts.push("(;GM[1]FF[4]CA[UTF-8]");
    parts.push("AP[1919围棋]");
    parts.push(`SZ[${boardSize}]`);
    parts.push(`PB[${info.pb?.value || '黑棋'}]`);
    parts.push(`PW[${info.pw?.value || '白棋'}]`);

    if (info.br?.value) parts.push(`BR[${info.br.value}]`);
    if (info.wr?.value) parts.push(`WR[${info.wr.value}]`);
    if (info.dt?.value) parts.push(`DT[${info.dt.value}]`);
    if (info.gn?.value) parts.push(`EV[${info.gn.value}]`);
    if (info.km?.value) parts.push(`KM[${info.km.value}]`);
    if (info.re?.value) parts.push(`RE[${info.re.value}]`);

    parts.push("RU[Chinese]");

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      if (coord) {
        const sgfCoord = this.toSgfCoord(coord, boardSize);
        if (sgfCoord) {
          const color = i % 2 === 0 ? 'B' : 'W';
          parts.push(`;${color}[${sgfCoord}]`);
        }
      }
    }

    parts.push(")");
    return parts.join('');
  }

  /**
   * 坐标转换：1919坐标(0-360) → SGF坐标(a-s)
   */
  private toSgfCoord(val: string, boardSize: number): string | null {
    try {
      const valInt = parseInt(val, 10);
      const x = valInt % boardSize;
      const y = Math.floor(valInt / boardSize);
      return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
    } catch {
      return null;
    }
  }
}