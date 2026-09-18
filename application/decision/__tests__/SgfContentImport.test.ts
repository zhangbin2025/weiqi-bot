import { describe, it, expect } from 'vitest';
import { DecisionApp } from '../DecisionApp';
import { DecisionService } from '../../../services/decision/DecisionService';

// 第5手 B[nc] 后有 3 个变化分支（最高60%，最低30%），实战选点胜率回退取最低分支30% => 差30%>20% 触发恶手题
const SGF = '(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[黑]PW[白]KM[6.5]RE[B+R]\n;B[pd];W[dd];B[qp];W[dp];B[nc]C[黑50%]\n(;B[qf]C[黑60.0%]W[nc];B[fc])\n(;B[nd]C[黑30.0%]W[po])\n(;B[fq]C[黑55.0%]))';

// 9 路棋盘，坐标均在 a-i 内
const SMALL = '(;GM[1]FF[4]CA[UTF-8]SZ[9]PB[黑]PW[白]KM[5.5]RE[B+R]\n;B[cc];W[gc];B[cg];W[eg];B[gg]C[黑50%]\n(;B[ee]C[黑60.0%]W[gg])\n(;B[dd]C[黑30.0%]W[fg])\n(;B[ff]C[黑55.0%]))';

describe('generateFromSGFContent 端到端', () => {
  it('从 SGF 内容生成恶手题并写入 boardSize', async () => {
    const app = new DecisionApp(undefined, new DecisionService());
    const res = await app.generateFromSGFContent(SGF, { fileName: 't.sgf' });
    expect(res.problems.length).toBeGreaterThan(0);
    for (const p of res.problems) { expect(p.metadata.boardSize).toBe(19); }
  });

  it('9 路棋盘 boardSize 正确传递', async () => {
    const app = new DecisionApp(undefined, new DecisionService());
    const res = await app.generateFromSGFContent(SMALL, { fileName: 's.sgf' });
    expect(res.problems.length).toBeGreaterThan(0);
    for (const p of res.problems) { expect(p.metadata.boardSize).toBe(9); }
  });
});
