/**
 * 定式构建服务
 * 对应 Python: weiqi-joseki/src/builder/katago_builder.py (auto 模式入口)
 *
 * 提供完整的定式库构建流程：
 * 1. 从 tar 文件提取四角着法
 * 2. CMS 频率统计
 * 3. 逆向遍历 + 单链检测 + top-k
 * 4. 保存到数据库
 */

import { JosekiBuilder, type JosekiItem, type BuildConfig } from "@domain/joseki/JosekiBuilder";
import { CountMinSketch } from "../../utils/CMS.js";

/** 构建选项 */
export interface BuildOptions extends BuildConfig {
  /** 限制处理的文件数量（测试用） */
  limit?: number;
}

/**
 * 临时文件行数据
 * 格式: direction|coords|winrates|firstColor
 */
interface TempLine {
  direction: string;
  coords: string[];
  winrates: number[];
  firstColor: string;
}

/**
 * 定式构建服务
 */
export class JosekiBuildService {
  /**
   * 从序列列表构建（内存模式）
   */
  async buildFromSequences(
    sequences: Array<{ stdCoords: string[]; winrates: number[]; firstColor: string }>,
    options: BuildOptions = {}
  ): Promise<JosekiItem[]> {
    const builder = new JosekiBuilder(options);
    for (const seq of sequences) {
      builder.addSequence(seq);
    }
    return builder.build(options);
  }

  /**
   * 从临时数据流式构建（auto 模式）
   * 支持已提取好的临时文件数据
   */
  async buildFromTempData(
    tempLines: Iterable<TempLine>,
    cms: CountMinSketch,
    options: BuildOptions = {},
    totalSequences: number = 0
  ): Promise<JosekiItem[]> {
    const builder = new JosekiBuilder(options);
    // 使用已有的 CMS，不需要重新统计
    return builder.buildFromTempData(tempLines, cms, options, totalSequences);
  }

  /**
   * 从最新数据构建（简化版，用于测试）
   */
  async buildFromLatest(options: BuildOptions = {}): Promise<JosekiItem[]> {
    console.log("🚀 定式库构建 - 简化版（测试数据）");
    const builder = new JosekiBuilder(options);
    builder.addSequence({
      stdCoords: ["pd", "qc", "pc", "qd"],
      winrates: [0.5, 0.51, 0.52, 0.51],
      firstColor: "B",
    });
    const result = builder.build(options);
    console.log(`构建完成: ${result.length} 条定式`);
    return result;
  }

  /**
   * 解析临时文件行
   * 格式: direction|coord1 coord2 ...|wr1 wr2 ...|firstColor
   */
  static parseTempLine(line: string): TempLine | null {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) return null;
    const parts = trimmed.split("|");
    const direction = parts[0] ?? "ruld";
    const coordsStr = parts[1] ?? "";
    const winrateStr = parts[2] ?? "";
    const firstColor = parts[3] ?? "B";
    const coords = coordsStr ? coordsStr.split(" ").filter(Boolean) : [];
    const winrates = winrateStr
      ? winrateStr.split(" ").filter(Boolean).map((w) => {
          const n = parseFloat(w);
          return isNaN(n) ? 0.5 : n;
        })
      : [];
    return { direction, coords, winrates, firstColor };
  }

  /**
   * 序列数据转临时文件行
   */
  static toTempLine(data: {
    stdCoords: string[];
    winrates: number[];
    firstColor: string;
  }): string {
    const wrStr = data.winrates.map((w) => w.toFixed(4)).join(" ");
    return `std|${data.stdCoords.join(" ")}|${wrStr}|${data.firstColor}`;
  }
}
