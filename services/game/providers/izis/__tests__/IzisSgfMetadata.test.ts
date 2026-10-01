/**
 * @fileoverview IzisParser SGF 元数据解析单元测试
 *
 * 验证 parseSgfMetadata 使用 domain/sgf 接口后的行为一致性。
 * 覆盖场景：标准 SGF、缺失 KM 字段、空 SGF、Pass 着法、让子棋。
 */

import { describe, it, expect } from 'vitest';
import { IzisParser } from '../IzisParser';

/** 标准 SGF（隐智棋盘格式） */
const STANDARD_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[张三]PW[李四]
BR[5d]WR[3k]
KM[6.5]RU[Chinese]DT[2026-09-30]RE[B+2.5]
;B[pd];W[dp];B[pp];W[dd]
)`;

/** 缺少 KM/RU/DT/RE 的 SGF */
const MINIMAL_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑棋]PW[白棋]
;B[aa];W[ba]
)`;

/** 含 Pass 着法的 SGF */
const PASS_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑方]PW[白方]KM[6.5]
;B[pd];W[dp];B[];W[pp]
)`;

/** 让子棋 SGF */
const HANDICAP_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[让子方]PW[受让方]
KM[0]HA[2]RU[Chinese]AB[dd][pp]
;W[jj];B[qq]
)`;

/** 9 路棋盘 SGF */
const SMALL_BOARD_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[9]
PB[黑方]PW[白方]KM[5.5]
;B[ee];W[ff]
)`;

/** 空字符串 */
const EMPTY_SGF = '';

describe('IzisParser.parseSgfMetadata', () => {
  const parser = new IzisParser();

  it('标准 SGF 应正确提取所有字段', () => {
    const meta = parser.parseSgfMetadata(STANDARD_SGF, 'game_001');
    expect(meta.source).toBe('izis-archive');
    expect(meta.gameId).toBe('game_001');
    expect(meta.blackName).toBe('张三');
    expect(meta.whiteName).toBe('李四');
    expect(meta.blackRank).toBe('5d');
    expect(meta.whiteRank).toBe('3k');
    expect(meta.width).toBe(19);
    expect(meta.height).toBe(19);
    expect(meta.komi).toBe(6.5);
    expect(meta.handicap).toBe(0);
    expect(meta.rules).toBe('Chinese');
    expect(meta.date).toBe('2026-09-30');
    expect(meta.result).toBe('B+2.5');
    expect(meta.movesCount).toBe(4);
  });

  it('缺少 KM 时应回退默认 6.5', () => {
    const meta = parser.parseSgfMetadata(MINIMAL_SGF, 'game_002');
    expect(meta.komi).toBe(6.5);
    expect(meta.handicap).toBe(0);
    expect(meta.movesCount).toBe(2);
    expect(meta.blackRank).toBe('');
    expect(meta.whiteRank).toBe('');
  });

  it('含 Pass 着法时应正确统计手数', () => {
    const meta = parser.parseSgfMetadata(PASS_SGF, 'game_003');
    // B[pd], W[dp], B[] (pass), W[pp] = 4 手
    expect(meta.movesCount).toBe(4);
  });

  it('让子棋应正确解析 HA 和 AB[]，AB 不计入着法数', () => {
    const meta = parser.parseSgfMetadata(HANDICAP_SGF, 'game_004');
    expect(meta.handicap).toBe(2);
    expect(meta.komi).toBe(0);
    // AB[dd][pp] 不应被计入着法
    expect(meta.movesCount).toBe(2);
  });

  it('9 路棋盘应正确解析尺寸', () => {
    const meta = parser.parseSgfMetadata(SMALL_BOARD_SGF, 'game_005');
    expect(meta.width).toBe(9);
    expect(meta.height).toBe(9);
    expect(meta.komi).toBe(5.5);
  });

  it('空 SGF 应返回默认值', () => {
    const meta = parser.parseSgfMetadata(EMPTY_SGF, 'game_empty');
    expect(meta.movesCount).toBe(0);
    expect(meta.width).toBe(19);
    expect(meta.height).toBe(19);
    expect(meta.komi).toBe(6.5);
    expect(meta.blackName).toBe('黑棋');
    expect(meta.whiteName).toBe('白棋');
  });

  it('应正确传递 gameId', () => {
    const meta = parser.parseSgfMetadata(STANDARD_SGF, '875347');
    expect(meta.gameId).toBe('875347');
  });
});
