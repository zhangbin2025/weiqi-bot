/**
 * 死活题最小路数转换 - 与 SGF 解析管线集成测试
 * 验证：经 buildTsumegoMinBoard 处理后，sgfToReplayData 解析出的小棋盘
 *       路数、摆子、着法坐标全部落在小棋盘范围内。
 */
import { describe, it, expect } from 'vitest';
import { buildTsumegoMinBoard, sgfToReplayData } from '../sgf/index.js';

// 模拟抓取到的 19 路死活题（黑白摆子在右上角局部，黑先杀白，带分支）
const SGF_19 =
  '(;GM[1]FF[4]SZ[19]PB[Black]PW[White]' +
  'AB[qd][pe][qf][rf]AW[pd][qe][pf][qg]' +
  '(;B[re];W[rd];B[rc])' +   // 正解分支1
  '(;B[rd];W[re])' +          // 分支2
  '(;B[rc];W[re])' +          // 分支3
  ')';

describe('TsumegoMinBoard + SGF 管线 集成', () => {
  it('19 路死活题被压缩为小棋盘，摆子与着法坐标均在范围内', () => {
    const res = buildTsumegoMinBoard(SGF_19);
    expect(res).not.toBeNull();
    if (!res) return;

    const data = sgfToReplayData(res.sgf);
    expect(data).not.toBeNull();
    if (!data) return;

    // 路数被压缩到标准小棋盘
    expect([9, 13]).toContain(data.board_size);
    expect(data.board_size).toBe(res.size);

    // 摆子全部在范围内
    for (const s of data.handicap_stones ?? []) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(data.board_size);
      expect(s.y).toBeLessThan(data.board_size);
    }

    // 遍历整棵树所有着法坐标均在范围内
    const walk = (n: typeof data.tree) => {
      if (n.color && n.coord && n.coord !== 'tt') {
        const x = n.coord.charCodeAt(0) - 97;
        const y = n.coord.charCodeAt(1) - 97;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(data.board_size);
        expect(y).toBeLessThan(data.board_size);
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(data.tree);
  });

  it('普通 19 路对局不被压缩（board_size 保持 19）', () => {
    const normal = '(;GM[1]FF[4]SZ[19];B[pd];W[dp];B[qp];W[pq];B[dd])';
    const res = buildTsumegoMinBoard(normal);
    expect(res).toBeNull();
    expect(sgfToReplayData(normal)?.board_size).toBe(19);
  });

  it('已是 9 路的死活题不被压缩', () => {
    const small = '(;GM[1]FF[4]SZ[9]AB[cc][gc]AW[cg][gg];B[ec];W[fc])';
    expect(buildTsumegoMinBoard(small)).toBeNull();
    expect(sgfToReplayData(small)?.board_size).toBe(9);
  });
});
