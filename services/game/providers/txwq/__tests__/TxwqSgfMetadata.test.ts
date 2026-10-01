/**
 * @fileoverview TxwqParser SGF 元数据解析单元测试
 *
 * 验证 buildMetadata 使用 domain/sgf 接口后的行为一致性。
 * 覆盖场景：标准 SGF、缺 KM/HA、让子 AB[]、Pass 着法、空/异常输入。
 */

import { describe, it, expect } from 'vitest';
import { TxwqParser } from '../TxwqParser';

/** 标准 SGF（腾讯围棋 API 返回格式） */
const STANDARD_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[柯洁]PW[申真谞]
KM[7.5]RU[Chinese]DT[2026-09-30]RE[B+2.5]
GN[第28届农心杯]
;B[pd];W[dp];B[pp];W[dd];B[qf];W[dn];B[ce];W[ck]
)`;

/** 缺少 KM/HA/RU 字段的 SGF */
const MINIMAL_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑棋]PW[白棋]
;B[aa];W[ba];B[ab];W[bb]
)`;

/** 让子棋 SGF */
const HANDICAP_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑方]PW[白方]
KM[0]HA[2]RU[Chinese]AB[dd][pp]
;W[jj];B[qq];W[qd]
)`;

/** 含 Pass 着法的 SGF */
const PASS_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑方]PW[白方]KM[6.5]
;B[pd];W[dp];B[];W[pp]
)`;

/** 13 路棋盘 */
const SMALL_BOARD_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[13]
PB[黑方]PW[白方]KM[3.5]
;B[cc];W[dd]
)`;

/** 空字符串 */
const EMPTY_SGF = '';

describe('TxwqParser.buildMetadata', () => {
  it('标准 SGF 应正确提取所有字段', () => {
    const meta = TxwqParser.buildMetadata(STANDARD_SGF, 'chess123');
    expect(meta.source).toBe('txwq');
    expect(meta.gameId).toBe('chess123');
    expect(meta.blackName).toBe('柯洁');
    expect(meta.whiteName).toBe('申真谞');
    expect(meta.width).toBe(19);
    expect(meta.height).toBe(19);
    expect(meta.komi).toBe(7.5);
    expect(meta.handicap).toBe(0);
    expect(meta.rules).toBe('Chinese');
    expect(meta.date).toBe('2026-09-30');
    expect(meta.result).toBe('B+2.5');
    expect(meta.movesCount).toBe(8);
  });

  it('缺少 KM 时应回退默认 6.5', () => {
    const meta = TxwqParser.buildMetadata(MINIMAL_SGF, 'chess456');
    expect(meta.komi).toBe(6.5);
    expect(meta.handicap).toBe(0);
    expect(meta.movesCount).toBe(4);
  });

  it('让子棋应正确解析 HA 和 AB[]，AB 不计入着法数', () => {
    const meta = TxwqParser.buildMetadata(HANDICAP_SGF, 'chess789');
    expect(meta.handicap).toBe(2);
    expect(meta.komi).toBe(0);
    expect(meta.movesCount).toBe(3);
  });

  it('含 Pass 着法时应正确统计手数', () => {
    const meta = TxwqParser.buildMetadata(PASS_SGF, 'chess000');
    expect(meta.movesCount).toBe(4);
  });

  it('13路棋盘应正确解析尺寸', () => {
    const meta = TxwqParser.buildMetadata(SMALL_BOARD_SGF, 'chess13');
    expect(meta.width).toBe(13);
    expect(meta.height).toBe(13);
    expect(meta.komi).toBe(3.5);
  });

  it('空 SGF 应返回默认值', () => {
    const meta = TxwqParser.buildMetadata(EMPTY_SGF, 'chess_empty');
    expect(meta.movesCount).toBe(0);
    expect(meta.width).toBe(19);
    expect(meta.height).toBe(19);
    expect(meta.komi).toBe(6.5);
    expect(meta.blackName).toBe('黑棋');
    expect(meta.whiteName).toBe('白棋');
  });

  it('应正确传递 chessId', () => {
    const meta = TxwqParser.buildMetadata(STANDARD_SGF, 'abc-123-def');
    expect(meta.gameId).toBe('abc-123-def');
  });
});
