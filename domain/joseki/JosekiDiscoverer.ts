/**
 * 定式发现器
 * 对应 Python: weiqi-joseki/src/discover/discoverer.py
 *
 * 实现四角定式发现算法，支持动态加载子树
 */

import type { IJosekiTrie } from "./JosekiTrie";
import type { IDiscoveredPattern } from "../../services/joseki/discover/types";
import type { RawMove } from "./ICornerExtractor";
import type { IJosekiLoader } from "./IJosekiLoader";
import { SGFParser } from "../sgf/SGFParser";
import { CornerExtractor } from "./CornerExtractor";
import { JosekiMatcher } from "./JosekiMatcher";
import { convertToTopRight, normalizeCornerSequence } from "../coordinate/CornerConverter";
import { exportTreeFromEndpoints } from "./JosekiExporter";

/** 发现选项 */
export interface DiscoverOptions {
  firstN: number | undefined;
  minMatchLen: number | undefined;
  exportDepth: number | undefined;
  onProgress: ((percent: number, status: string, detail?: string) => void) | undefined;
}

/** 默认选项 */
const DEFAULT_OPTS: DiscoverOptions = {
  firstN: 80,
  minMatchLen: 4,
  exportDepth: 5,
  onProgress: undefined,
};

/** 9路范围配置 */
const CORNER_9LU: Record<string, { colMin: number; colMax: number; rowMin: number; rowMax: number }> = {
  tl: { colMin: 0, colMax: 8, rowMin: 0, rowMax: 8 },
  tr: { colMin: 10, colMax: 18, rowMin: 0, rowMax: 8 },
  bl: { colMin: 0, colMax: 8, rowMin: 10, rowMax: 18 },
  br: { colMin: 10, colMax: 18, rowMin: 10, rowMax: 18 },
};

/** 检查指定角的9路范围内是否有棋子 */
function hasStoneInCorner9lu(moves: string[], cornerKey: string): boolean {
  const range = CORNER_9LU[cornerKey];
  if (!range) return false;
  for (const coord of moves) {
    if (!coord || coord === "tt" || coord.length !== 2) continue;
    const col = coord.charCodeAt(0) - 97;
    const row = coord.charCodeAt(1) - 97;
    if (col >= range.colMin && col <= range.colMax && row >= range.rowMin && row <= range.rowMax)
      return true;
  }
  return false;
}

/**
 * 发现定式（支持动态加载）
 */
export async function discover(
  sgfList: string[],
  trie: IJosekiTrie,
  loader: IJosekiLoader,
  options?: Partial<DiscoverOptions>
): Promise<IDiscoveredPattern[]> {
  const opts: DiscoverOptions = {
    firstN: options?.firstN ?? DEFAULT_OPTS.firstN!,
    minMatchLen: options?.minMatchLen ?? DEFAULT_OPTS.minMatchLen!,
    exportDepth: options?.exportDepth ?? DEFAULT_OPTS.exportDepth!,
    onProgress: options?.onProgress ?? DEFAULT_OPTS.onProgress,
  };

  const minMatchLen = opts.minMatchLen!;
  const firstN = opts.firstN!;

  const parser = new SGFParser();
  const extractor = new CornerExtractor();
  const matcher = new JosekiMatcher(loader);
  const allPatterns: IDiscoveredPattern[] = [];

  for (let i = 0; i < sgfList.length; i++) {
    opts.onProgress?.(Math.round((i / sgfList.length) * 100), "分析棋谱", `${i + 1}/${sgfList.length}`);

    const sgf = sgfList[i]!;
    const parsed = parser.parse(sgf);
    const moves: RawMove[] = parsed.moves.slice(0, firstN).map((m) => [m.color, m.coord] as RawMove);
    const gameInfo = extractGameInfo(parsed, i);

    const corners = extractor.extractFourCorners(moves, firstN);

    for (const cornerKey of ["tl", "tr", "bl", "br"] as const) {
      const cornerMoves = corners[cornerKey];
      if (!cornerMoves || cornerMoves.moves.length < minMatchLen) continue;

      const coords = cornerMoves.moves.map((m) => m.coord);

      // 9路范围检查
      if (!hasStoneInCorner9lu(coords, cornerKey)) continue;

      // 转换到右上角 + 归一化
      const trMoves = convertToTopRight(coords, cornerKey);
      const { normalized } = normalizeCornerSequence(trMoves);

      // 匹配定式
      const result = await matcher.match(
        normalized.map((c, idx) => [idx % 2 === 0 ? "B" : "W", c] as RawMove),
        trie
      );

      if (result.matchedPath.length < minMatchLen) continue;

      // 收集定式终点
      const endpoints = await matcher.collectJosekiEndpoints(result.matchedPath, trie);
      if (endpoints.length === 0) continue;

      // 导出定式树 SGF
      const prefixStr = result.matchedPath.join(" ");
      const treeSgf = exportTreeFromEndpoints(endpoints, normalized, prefixStr);

      // 统计数据
      const totalFreq = endpoints.reduce((s, e) => s + e.freq, 0);
      const avgProb = endpoints.reduce((s, e) => s + e.prob, 0) / endpoints.length;

      const pattern: IDiscoveredPattern = {
        prefix: result.matchedPath.join(" "),
        frequency: totalFreq,
        prefixLen: result.matchedPath.length,
        totalMoves: cornerMoves.moves.length,
        sourceCorner: cornerKey,
        probability: avgProb,
        extractedMoves: treeSgf,
        gameInfo,
      };

      // 胜率统计
      const wrData = endpoints.filter((e) => e.winrate).map((e) => e.winrate!);
      if (wrData.length > 0) {
        const avgDelta = wrData.reduce((s, w) => s + w.delta, 0) / wrData.length;
        pattern.winrateDelta = avgDelta;
        const totalSamples = wrData.reduce((s, w) => s + (w.samples ?? 0), 0);
        if (totalSamples > 0) {
          pattern.winrateStats = {
            delta: avgDelta,
            stddev: wrData.reduce((s, w) => s + (w.stddev ?? 0), 0) / wrData.length,
            samples: totalSamples,
            positive: wrData.reduce((s, w) => s + (w.positive ?? 0), 0),
            negative: wrData.reduce((s, w) => s + (w.negative ?? 0), 0),
            neutral: wrData.reduce((s, w) => s + (w.neutral ?? 0), 0),
          };
        }
      }
      allPatterns.push(pattern);
    }
  }

  opts.onProgress?.(100, "分析完成");
  return allPatterns.sort((a, b) => {
    if (b.prefixLen !== a.prefixLen) return b.prefixLen - a.prefixLen;
    return b.frequency - a.frequency;
  });
}

function extractGameInfo(parsed: {
  gameInfo?: { black?: string; white?: string; date?: string };
}, sgfIndex: number): { black: string; white: string; date: string; sgfIndex: number } {
  const info = parsed.gameInfo ?? {};
  return {
    black: info.black ?? "Unknown",
    white: info.white ?? "Unknown",
    date: info.date ?? "Unknown",
    sgfIndex,
  };
}
