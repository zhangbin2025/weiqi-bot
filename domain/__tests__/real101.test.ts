import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { buildTsumegoMinBoard, coordToPos, sgfToReplayData } from "../sgf/index.js";

// 真实抓取的问题：101围棋网 qday/2026/9/19/3（右上角死活题，最右侧为一路线）
// SGF 由真实 Weiqi101Provider 管线生成（base64 内联，保证测试确定性）
const REAL_SGF_B64 = "KDtHTVsxXUZGWzRdQ0FbVVRGLThdU1pbMTldUEJbXVBXWzhLKyDmrbvmtLvpophdQ1sgLSA4SyvmrbvmtLvpopggLSDpu5HlhYhdQUJbb2ZdQUJbcGhdQUJbcWhdQUJbb2ddQUJbcmRdQUJbcWJdQUJbc2ddQUJbb2NdQUJbc2hdQUJbcmhdQUJbc2RdQUJbcWNdQUJbb2VdQUJbcGRdQVdbcmddQVdbcmJdQVdbc2ZdQVdbcmVdQVdbcmNdQVdbcGddQVdbcGZdQVdbcWVdQVdbcGVdQVdbcWddQVdbcWRdCihDW+ato+ino+WbviAtIGhhb3Jhbl07QltyZl07V1tzY107QltzZV07V1tzZl07QltzZV0pCihDW+ato+ino+WbviAtIGhhb3Jhbl07QltyZl07V1txZl07QltyYV0pCihDW+ato+ino+WbviAtIHN1cGVyLmd1a291XTtCW3JmXTtXW3FmXTtCW3NiXTtXW3JhXTtCW3NjXSkKKENb5q2j6Kej5Zu+IC0g6aOe6Iqx5Ly85qKmXTtCW3JmXTtXW3FmXTtCW3NiXTtXW3JhXTtCW3NjXTtXW3NlXTtCW3JmXSkKKENb5q2j6Kej5Zu+IC0gcm9ib3Rlcl07QltyZl07V1txZl07QltzYl07V1txYV07QltzY10pCihDW+ato+ino+WbviAtIGtlbm55XTtCW3JmXTtXW3FmXTtCW3NiXSkKKENb5q2j6Kej5Zu+IC0g5rW35biC6JyD5qW8XTtCW3JmXTtXW3FmXTtCW3NiXTtXW3JhXTtCW3FhXSkKKENb5q2j6Kej5Zu+IC0ga2VubnldO0JbcmZdO1dbcWZdO0Jbc2JdO1dbcWFdO0JbcGFdKQooQ1vlpLHotKXlm74gLSBqc2hzaF07QltyZl07V1txZl07QltzYl07V1txYV07QltwYl07V1tzYV0pCihDW+Wksei0peWbviAtIHdfNTQxNjUxNzYxMTUyNV07QltxZl07V1tzY10pCihDW+Wksei0peWbviAtIOavleaWr+a2tV07QltyYV07V1tzZV0pKQ==";

function collect(sgf: string, pred: (p: { x: number; y: number }) => boolean): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const m = sgf.match(/[ABW]\[([a-z]{1,2})\]/g) || [];
  for (const s of m) {
    const p = coordToPos(s.slice(2, -1));
    if (p && pred(p)) out.push(p);
  }
  return out;
}

describe("real 101 problem e2e (右上角死活题)", () => {
  it("最右侧一路的棋子转换后仍在小棋盘最右列", () => {
    const sgf = Buffer.from(REAL_SGF_B64, "base64").toString("utf-8");
    expect(sgf).toContain("SZ[19]");

    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;

    const data = sgfToReplayData(res.sgf)!;
    const size = res.size;
    const rightCol = size - 1;

    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("·"));
    for (const s of data.handicap_stones ?? []) grid[s.y][s.x] = s.color === "B" ? "●" : "○";
    const lines: string[] = [];
    lines.push("board_size=" + size + " origin=" + JSON.stringify(res.origin));
    lines.push("   " + Array.from({ length: size }, (_, i) => String.fromCharCode(97 + i)).join(" "));
    for (let y = 0; y < size; y++) lines.push(String(y).padStart(2, " ") + " " + grid[y].join(" "));
    writeFileSync("/tmp/real101_det.out", lines.join("\n"));

    const right = collect(sgf, p => p.x === 18);
    expect(right.length).toBeGreaterThan(0);
    for (const c of right) expect(c.x - res.origin.x).toBe(rightCol);

    const top = collect(sgf, p => p.y === 0);
    for (const c of top) expect(c.y - res.origin.y).toBe(0);
  });
});
