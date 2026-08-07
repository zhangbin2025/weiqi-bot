/**
 * 角坐标转换器
 * 实现四角归一化和对称处理
 * 参考 Python: weiqi-joseki/src/core/coords.py
 */

/**
 * SGF 坐标转数字坐标
 * @param sgf - SGF 坐标（如 'pd'）
 * @returns [col, row]
 */
function sgfToNums(sgf: string): [number, number] {
  if (!sgf || sgf.length !== 2) {
    throw new Error(`Invalid SGF coordinate: ${sgf}`);
  }
  return [sgf.charCodeAt(0) - 97, sgf.charCodeAt(1) - 97];
}

/**
 * 数字坐标转 SGF 坐标
 * @param col - 列号 (0-18)
 * @param row - 行号 (0-18)
 * @returns SGF 坐标
 */
function numsToSgf(col: number, row: number): string {
  return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
}

/**
 * 将坐标转换到右上角（归一化）
 * @description 将四个角的坐标统一转换到右上角视角
 * @param coords - 原始坐标列表 ['dd', 'pd', ...]
 * @param cornerKey - 角标识 'tl' | 'tr' | 'bl' | 'br'
 * @returns 转换到右上角后的坐标列表
 * @ai-example
 * convertToTopRight(['dd', 'pd'], 'tr'); // ['dd', 'pd']
 * convertToTopRight(['dd', 'dp'], 'tl'); // ['pd', 'pp']
 */
export function convertToTopRight(coords: string[], cornerKey: string): string[] {
  const result: string[] = [];

  for (const coord of coords) {
    // 处理特殊值
    if (!coord || coord === 'tt' || coord === 'pass') {
      result.push(coord);
      continue;
    }

    try {
      const [col, row] = sgfToNums(coord);
      let newCol: number;
      let newRow: number;

      switch (cornerKey) {
        case 'tl':
          // 左上角 → 右上角：水平翻转
          // (col, row) -> (18-col, row)
          newCol = 18 - col;
          newRow = row;
          break;

        case 'tr':
          // 右上角：不变
          newCol = col;
          newRow = row;
          break;

        case 'bl':
          // 左下角 → 右上角：旋转180°
          // (col, row) -> (18-col, 18-row)
          newCol = 18 - col;
          newRow = 18 - row;
          break;

        case 'br':
          // 右下角 → 右上角：垂直翻转
          // (col, row) -> (col, 18-row)
          newCol = col;
          newRow = 18 - row;
          break;

        default:
          result.push(coord);
          continue;
      }

      result.push(numsToSgf(newCol, newRow));
    } catch {
      result.push(coord);
    }
  }

  return result;
}

/**
 * 归一化角序列（处理对称等价）
 * @description 以过右上角顶点的对角线 (col+row=18) 为对称轴，选择标准方向
 * @param trMoves - 已转换到右上角的坐标列表
 * @returns 归一化结果 { normalized: 归一化序列, mirrored: 是否镜像 }
 * @ai-example
 * const result = normalizeCornerSequence(['pd', 'dd', 'pp']);
 * console.log(result.normalized); // 标准化后的序列
 * console.log(result.mirrored); // 是否被镜像
 */
export function normalizeCornerSequence(trMoves: string[]): {
  normalized: string[];
  mirrored: boolean;
} {
  for (const coord of trMoves) {
    // 跳过特殊值
    if (!coord || coord === 'tt' || coord === 'pass' || coord.length !== 2) {
      continue;
    }

    const col = coord.charCodeAt(0) - 97;
    const row = coord.charCodeAt(1) - 97;
    const coordSum = col + row;

    if (coordSum === 18) {
      // 在对角线上，继续判断下一手
      continue;
    }

    if (coordSum < 18) {
      // 上半部分（靠近上边缘），已是标准方向
      return { normalized: trMoves, mirrored: false };
    } else {
      // 下半部分（靠近左边缘），需要镜像
      // 镜像操作: (col, row) -> (18-row, 18-col)
      const mirrored = trMoves.map((c) => {
        if (!c || c === 'tt' || c === 'pass' || c.length !== 2) {
          return c;
        }
        const cc = c.charCodeAt(0) - 97;
        const rr = c.charCodeAt(1) - 97;
        return numsToSgf(18 - rr, 18 - cc);
      });
      return { normalized: mirrored, mirrored: true };
    }
  }

  // 所有着法都在对角线上或为空
  return { normalized: trMoves, mirrored: false };
}

/**
 * 比较两个坐标序列的字典序
 * @param a - 序列A
 * @param b - 序列B
 * @returns -1 (a < b), 0 (a == b), 1 (a > b)
 */
export function compareCoordSequences(a: string[], b: string[]): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    const coordA = a[i] ?? '';
    const coordB = b[i] ?? '';
    if (coordA < coordB) return -1;
    if (coordA > coordB) return 1;
  }
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}
