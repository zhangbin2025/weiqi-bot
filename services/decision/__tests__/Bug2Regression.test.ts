import { describe, it, expect } from 'vitest';
import { DecisionGenerator } from '../DecisionGenerator';
import { writeFileSync } from 'fs';

// 主分支在第 5 手 B[nc] 后有 5 个候选分支；
// 主线实际着法 W[qq] 的胜率最低(40)，在按胜率排序后排名第 5 → practicalRank=5。
// 修复前：实战选点标签会取 rankLabels[4] = undefined → “实战（undefined）”。
// 修复后：回退为 “实战（第5选）”。
const sgf = `(;GM[1]FF[4]SZ[19]PB[黑]PW[白]
;B[pd];W[dd];B[qp];W[dp];B[nc]
(;W[qq]C[黑40%])
(;W[po]C[黑45%])
(;W[nm]C[黑50%])
(;W[lk]C[黑55%])
(;W[ji]C[黑60%])
;W[qq];B[pp];W[op];B[oo])`;

describe('DecisionGenerator 实战选点标签越界回归', () => {
  it('实战排名 > 4 时标签不应出现 undefined', () => {
    const gen = new DecisionGenerator();
    const problems = gen.generate(sgf, { blunderOnly: false, blunderThreshold: 100 });

    let out = 'total=' + problems.length + '\n';
    let target: any = undefined;
    for (const p of problems) {
      for (const o of p.options) {
        out += `mn=${p.metadata.moveNumber} label=${o.label} isPractical=${o.isPractical} pos=${o.position}\n`;
      }
      if (p.metadata.moveNumber === 5) target = p;
    }
    writeFileSync('/tmp/bug2-out.txt', out);

    expect(target).toBeTruthy();
    for (const o of target.options) {
      expect(String(o.label)).not.toContain('undefined');
    }
    const practical = target.options.find((o: any) => o.isPractical);
    expect(practical).toBeTruthy();
    expect(practical.label).toBe('实战（第5选）');
  });
});
