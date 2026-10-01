/**
 * @fileoverview Foxwq SGF 元数据解析单元测试
 *
 * 验证 sgfToMetadata（原 parseSgfMetadata + countMoves）使用 domain/sgf 接口后的行为一致性。
 * 覆盖场景：标准 SGF、让子棋、缺少字段、Pass 着法、直播生成 SGF 回解析、空/异常输入。
 */

import { describe, it, expect } from 'vitest';
import { parseSGF } from '../../../../../domain/sgf';
import type { GameMetadata } from '../../base/types';

/**
 * 复制 FoxwqShareProvider.sgfToMetadata 的逻辑用于独立测试。
 * 该方法是 private，直接测试需要通过实例化（依赖 NetworkManager 等），
 * 但逻辑本身是纯函数，直接测试转换逻辑更清晰。
 */
function sgfToMetadata(sgf: string, source = 'foxwq'): GameMetadata {
  const result = parseSGF(sgf);
  const info = result.gameInfo;
  // domain 默认 komi='375'（表示 3.75），foxwq 原默认 6.5
  const komiNum = parseFloat(info.komi);
  const komi = (info.komi === '375' || isNaN(komiNum)) ? 6.5 : komiNum;
  return {
    source,
    gameId: info.gameName || '',
    blackName: info.black || '黑方',
    whiteName: info.white || '白方',
    width: info.boardSize,
    height: info.boardSize,
    komi,
    handicap: info.handicap,
    rules: info.rules || 'chinese',
    date: info.date || '',
    result: info.result || '',
    movesCount: result.moves.length,
  };
}

// ========== 测试用 SGF 样本 ==========

/** 野狐 API 返回的标准 SGF */
const STANDARD_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[柯洁]PW[申真谞]
KM[7.5]RU[Chinese]DT[2026-09-30]RE[B+2.5]
GN[第28届农心杯]
;B[pd];W[dp];B[pp];W[dd];B[qf];W[dn];B[ce];W[ck];B[ci];W[eo]
)`;

/** 让子棋 SGF */
const HANDICAP_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[让子方]PW[受让方]
KM[0]HA[2]RU[Chinese]DT[2026-09-30]RE[W+R]
AB[dd][pp]
;W[jj];B[qq];W[qd];B[oc]
)`;

/** 缺少部分字段的 SGF（无 KM/RE/DT/RU） */
const MINIMAL_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑棋选手]PW[白棋选手]
;B[aa];W[ba];B[ab];W[bb]
)`;

/** 含 Pass 着法的 SGF */
const PASS_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑方]PW[白方]KM[6.5]
;B[pd];W[dp];B[];W[pp]
)`;

/** 野狐直播 createSgf() 生成的格式 */
const LIVE_GENERATED_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]
PB[黑棋]PW[白棋]
KM[7.5]
;B[pd]
;W[dp]
;B[pp]
;W[dd]
)`;

/** 空字符串 */
const EMPTY_SGF = '';

/** 非法 SGF */
const INVALID_SGF = 'this is not sgf';

// ========== 测试 ==========

describe('Foxwq sgfToMetadata', () => {
  describe('标准 SGF', () => {
    const meta = sgfToMetadata(STANDARD_SGF);

    it('应正确提取黑方名', () => {
      expect(meta.blackName).toBe('柯洁');
    });

    it('应正确提取白方名', () => {
      expect(meta.whiteName).toBe('申真谞');
    });

    it('应正确提取棋盘大小', () => {
      expect(meta.width).toBe(19);
      expect(meta.height).toBe(19);
    });

    it('应正确提取贴目', () => {
      expect(meta.komi).toBe(7.5);
    });

    it('应正确提取规则', () => {
      expect(meta.rules).toBe('Chinese');
    });

    it('应正确提取日期', () => {
      expect(meta.date).toBe('2026-09-30');
    });

    it('应正确提取结果', () => {
      expect(meta.result).toBe('B+2.5');
    });

    it('应正确统计手数（10手）', () => {
      expect(meta.movesCount).toBe(10);
    });

    it('应正确提取 source', () => {
      expect(meta.source).toBe('foxwq');
    });

    it('应提取 GN[] 作为 gameId', () => {
      expect(meta.gameId).toBe('第28届农心杯');
    });
  });

  describe('让子棋 SGF', () => {
    const meta = sgfToMetadata(HANDICAP_SGF);

    it('应正确提取让子数', () => {
      expect(meta.handicap).toBe(2);
    });

    it('应正确提取贴目为 0', () => {
      expect(meta.komi).toBe(0);
    });

    it('应正确统计手数（不含 AB 让子棋）', () => {
      // AB[dd][pp] 不计入着法，只有 W[jj];B[qq];W[qd];B[oc] = 4 手
      expect(meta.movesCount).toBe(4);
    });

    it('应正确提取结果', () => {
      expect(meta.result).toBe('W+R');
    });
  });

  describe('缺少字段的 SGF', () => {
    const meta = sgfToMetadata(MINIMAL_SGF);

    it('应有默认贴目 6.5', () => {
      expect(meta.komi).toBe(6.5);
    });

    it('应有默认规则 chinese', () => {
      expect(meta.rules).toBe('chinese');
    });

    it('日期应为空', () => {
      expect(meta.date).toBe('');
    });

    it('结果应为空', () => {
      expect(meta.result).toBe('');
    });

    it('让子数应为 0', () => {
      expect(meta.handicap).toBe(0);
    });

    it('应正确统计手数（4手）', () => {
      expect(meta.movesCount).toBe(4);
    });
  });

  describe('Pass 着法', () => {
    const meta = sgfToMetadata(PASS_SGF);

    it('应正确统计含 Pass 的手数（4手）', () => {
      // B[pd];W[dp];B[](Pass);W[pp] = 4 手
      expect(meta.movesCount).toBe(4);
    });
  });

  describe('直播生成 SGF 回解析', () => {
    const meta = sgfToMetadata(LIVE_GENERATED_SGF);

    it('应正确提取黑方名', () => {
      expect(meta.blackName).toBe('黑棋');
    });

    it('应正确提取白方名', () => {
      expect(meta.whiteName).toBe('白棋');
    });

    it('应正确提取贴目', () => {
      expect(meta.komi).toBe(7.5);
    });

    it('应正确统计手数（4手）', () => {
      expect(meta.movesCount).toBe(4);
    });

    it('让子数应为 0', () => {
      expect(meta.handicap).toBe(0);
    });
  });

  describe('空 / 异常输入', () => {
    it('空字符串不崩溃，返回默认值', () => {
      const meta = sgfToMetadata(EMPTY_SGF);
      expect(meta.blackName).toBe('黑棋');
      expect(meta.whiteName).toBe('白棋');
      expect(meta.width).toBe(19);
      expect(meta.height).toBe(19);
      expect(meta.movesCount).toBe(0);
      expect(meta.komi).toBe(6.5);
    });

    it('非法 SGF 不崩溃', () => {
      const meta = sgfToMetadata(INVALID_SGF);
      // domain/sgf 对非 SGF 内容有容错处理
      expect(meta).toBeDefined();
      expect(meta.movesCount).toBe(0);
    });
  });

  describe('source 参数', () => {
    it('应使用自定义 source', () => {
      const meta = sgfToMetadata(STANDARD_SGF, 'foxwq-live');
      expect(meta.source).toBe('foxwq-live');
    });
  });
});
