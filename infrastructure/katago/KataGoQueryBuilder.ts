/**
 * @fileoverview KataGo Analysis 协议查询构造器
 * @description 将 TS 层的分析选项转换为 KataGo 原生 analysis 协议的 JSON 格式
 */

import type { AnalyzeOptions, AnalyzeGameOptions } from '../ai/IAIEngine';

const BOARD_SIZE = 19;

/**
 * KataGo 查询构造器
 *
 * KataGo analysis 协议要求 JSON 单行，着法使用 GTP 坐标。
 * 此类负责 TS 层 {x, y} → GTP 坐标转换，以及查询 JSON 构造。
 */
export class KataGoQueryBuilder {

  // ========== 坐标转换 ==========

  /**
   * {x, y} 转 GTP 坐标
   * x:0,y:18 → "A1", x:3,y:3 → "D16", x:-1,y:-1 → "pass"
   *
   * 注意：GTP 坐标中 I 列被跳过（A-H, J-T）
   */
  static moveToGtp(x: number, y: number, boardSize = BOARD_SIZE): string {
    if (x < 0 || y < 0) return 'pass';
    // GTP 列：A=0, B=1, ..., H=7, J=8, K=9, ..., T=18 (跳过 I)
    const col = String.fromCharCode(x >= 8 ? 66 + x : 65 + x); // 66='B', 跳过 I(73)
    const row = (boardSize - y).toString();
    return col + row;
  }

  /**
   * GTP 坐标转 {x, y}
   * "A1" → {x:0, y:18}, "D16" → {x:3, y:3}, "pass" → {x:-1, y:-1}
   */
  static gtpToMove(gtp: string, boardSize = BOARD_SIZE): { x: number; y: number } {
    if (!gtp || gtp.toLowerCase() === 'pass') return { x: -1, y: -1 };

    const colChar = gtp.charCodeAt(0);
    // A=65, I=73 被跳过
    let x: number;
    if (colChar <= 72) { // A-H
      x = colChar - 65;
    } else { // J+
      x = colChar - 66; // 跳过 I
    }

    const row = parseInt(gtp.slice(1));
    const y = boardSize - row;

    return { x, y };
  }

  /**
   * Player 字符串转 KataGo 协议
   */
  static playerToString(player: 'black' | 'white'): 'B' | 'W' {
    return player === 'black' ? 'B' : 'W';
  }

  /**
   * 从 Move 对象提取 x, y（处理 pass 着法）
   */
  static moveToCoord(move: { x?: number; y?: number; pass?: boolean; player: unknown }): { x: number; y: number } {
    if ('pass' in move && move.pass) return { x: -1, y: -1 };
    return { x: move.x ?? -1, y: move.y ?? -1 };
  }

  // ========== 查询构造 ==========

  /**
   * 构造整盘分析查询
   *
   * 对应 KataGo analysis 协议：
   * {"id":"...", "moves":[["B","Q4"],["W","C16"]...], "rules":"chinese", ...}
   */
  static buildGameAnalysis(opts: AnalyzeGameOptions): object {
    const query: Record<string, unknown> = {
      moves: opts.moves.map(m => [
        this.playerToString(m.player),
        this.moveToGtp(m.x, m.y),
      ]),
      rules: opts.rules ?? 'chinese',
      komi: opts.komi,
      boardXSize: opts.boardXSize ?? BOARD_SIZE,
      boardYSize: opts.boardYSize ?? BOARD_SIZE,
    };

    // 可选字段
    if (opts.initialStones?.length) {
      query['initialStones'] = opts.initialStones.map(s => [
        this.playerToString(s.player),
        this.moveToGtp(s.x, s.y),
      ]);
    }

    if (opts.analyzeTurns !== undefined) query['analyzeTurns'] = opts.analyzeTurns;
    if (opts.maxVisits !== undefined) query['maxVisits'] = opts.maxVisits;
    // 注意：maxTime 不是 KataGo 支持的字段，已移除
    // 如果需要时间限制，应该在 analysis.cfg 中设置
    if (opts.analysisPVLen !== undefined) query['analysisPVLen'] = opts.analysisPVLen;
    if (opts.includeOwnership !== undefined) query['includeOwnership'] = opts.includeOwnership;
    if (opts.includeMovesOwnership !== undefined) query['includeMovesOwnership'] = opts.includeMovesOwnership;
    if (opts.reportDuringSearchEvery !== undefined) query['reportDuringSearchEvery'] = opts.reportDuringSearchEvery;
    if (opts.priority !== undefined) query['priority'] = opts.priority;
    if (opts.wideRootNoise !== undefined) query['wideRootNoise'] = opts.wideRootNoise;
    if (opts.overrideSettings) query['overrideSettings'] = opts.overrideSettings;

    return query;
  }

  /**
   * 构造单局面分析查询
   *
   * 复用 buildGameAnalysis，只分析最后一手
   */
  static buildSinglePosition(opts: AnalyzeOptions): object {
    const moves = opts.moveHistory.map(m => {
      const coord = this.moveToCoord(m as any);
      return [
        this.playerToString((m as any).player as 'black' | 'white'),
        this.moveToGtp(coord.x, coord.y),
      ];
    });

    const query: Record<string, unknown> = {
      moves,
      rules: opts.rules ?? 'chinese',
      komi: opts.komi,
      boardXSize: BOARD_SIZE,
      boardYSize: BOARD_SIZE,
      // 不指定 analyzeTurns → 只分析最后一手
    };

    // 处理让子棋的初始棋子
    if (opts.initialStones?.length) {
      query['initialStones'] = opts.initialStones.map(s => [
        this.playerToString((s as any).player as 'black' | 'white'),
        this.moveToGtp(s.x, s.y),
      ]);
    }

    if (opts.visits !== undefined) query['maxVisits'] = opts.visits;
    // 注意：maxTime 不是 KataGo 支持的字段，已移除
    // 如果需要时间限制，应该在 analysis.cfg 中设置
    // analysisPVLen 必须是 1-1000 之间的整数，0 表示不获取 PV（不传递该字段）
    if (opts.analysisPvLen && opts.analysisPvLen >= 1) query['analysisPVLen'] = opts.analysisPvLen;
    if (opts.includeMovesOwnership !== undefined) query['includeMovesOwnership'] = opts.includeMovesOwnership;
    if (opts.wideRootNoise !== undefined) query['wideRootNoise'] = opts.wideRootNoise;

    return query;
  }

  /**
   * 根据 analyzeTurns 计算预期返回几条结果
   *
   * 未指定 analyzeTurns → 1（只分析最后一手）
   * 指定了 → analyzeTurns.length
   */
  static expectedTurnCount(analyzeTurns?: number[]): number {
    return analyzeTurns?.length ?? 1;
  }
}
