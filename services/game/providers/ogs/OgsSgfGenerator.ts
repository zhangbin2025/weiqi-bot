/**
 * @fileoverview OGS SGF 生成器
 */
import type { GameMetadata } from '../base/types';
import type { OgsGameResponse, OgsGameData } from './types';

export class OgsSgfGenerator {
  /**
   * 生成 SGF 内容
   */
  generate(data: OgsGameResponse, metadata: GameMetadata): string {
    const parts: string[] = [];
    const gamedata = data.gamedata || {};

    // 头部
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push(metadata.width === metadata.height ? `SZ[${metadata.width}]` : `SZ[${metadata.width}:${metadata.height}]`);
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

    // 让子棋处理：优先从 initial_state 读取实际让子位置
    if (metadata.handicap > 0) {
      parts.push(`HA[${metadata.handicap}]`);
      const handicapStones = this.getHandicapStonesFromInitialState(
        gamedata,
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

    // 着法颜色判定：让子棋时白方先行
    const initialPlayer = gamedata.initial_player || 'black';
    const firstMoveColor = initialPlayer === 'white' ? 'W' : 'B';

    // 着法
    const moves = gamedata.moves || [];
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]!;
      if (move.length >= 2) {
        const x = move[0]!;
        const y = move[1]!;
        const coord = this.coordToSgf(x, y, metadata.height);
        const color = i % 2 === 0 ? firstMoveColor : (firstMoveColor === 'B' ? 'W' : 'B');
        parts.push(`;${color}[${coord}]`);
      }
    }

    parts.push(')');
    return parts.join('');
  }

  /**
   * OGS 坐标转 SGF 坐标
   * OGS: (0,0) = 左下角
   * SGF: (0,0) = 左下角（与 OGS 一致，无需翻转）
   */
  private coordToSgf(x: number, y: number, height: number): string {
    if (x === -1 && y === -1) {
      return ''; // pass
    }
    const sgfX = String.fromCharCode(97 + x);
    const sgfY = String.fromCharCode(97 + y);
    return sgfX + sgfY;
  }

  /**
   * 从 OGS initial_state 获取让子位置
   * OGS initial_state.black = "pddp" 表示 pd(15,3) + dp(3,15) 两个黑子
   * 每2个字符为一个 SGF 坐标
   */
  private getHandicapStonesFromInitialState(
    gamedata: OgsGameData,
    handicap: number,
    width: number,
    height: number
  ): string[] {
    const coords: string[] = [];

    // 优先从 initial_state 读取
    const initialState = gamedata.initial_state;
    if (initialState?.black) {
      const blackStr = initialState.black;
      for (let i = 0; i + 1 < blackStr.length; i += 2) {
        coords.push(blackStr.substring(i, i + 2));
      }
      if (coords.length > 0) {
        return coords;
      }
    }

    // 回退：使用标准星位计算
    return this.getHandicapStones(handicap, width, height);
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