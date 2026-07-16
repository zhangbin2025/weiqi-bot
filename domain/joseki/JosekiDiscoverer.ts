/**
 * 定式发现器（纯逻辑）
 * @description 实现四角定式发现算法，支持动态加载子树
 */

import type { IJosekiTrie } from './JosekiTrie';
import type { IDiscoveredPattern } from '../../services/joseki/discover/types';
import type { RawMove } from './ICornerExtractor';
import type { IJosekiLoader } from './IJosekiLoader';
import { SGFParser } from '../sgf/SGFParser';
import { CornerExtractor } from './CornerExtractor';
import { JosekiMatcher } from './JosekiMatcher';
import { convertToTopRight, normalizeCornerSequence } from '../coordinate/CornerConverter';
import { exportTreeFromEndpoints } from './JosekiExporter';

/**
 * 发现选项
 */
export interface DiscoverOptions {
  /** 前 N 手，默认 80 */
  firstN: number;
  /** 最小匹配长度，默认 4 */
  minMatchLen: number;
  /** 导出深度，默认 5 */
  exportDepth: number;
  /** 进度回调 */
  onProgress?: ((percent: number, status: string, detail?: string) => void) | undefined;
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
    firstN: options?.firstN ?? 80,
    minMatchLen: options?.minMatchLen ?? 4,
    exportDepth: options?.exportDepth ?? 5,
    onProgress: options?.onProgress,
  };

  const parser = new SGFParser();
  const extractor = new CornerExtractor();
  const matcher = new JosekiMatcher(loader);
  const allPatterns: IDiscoveredPattern[] = [];

  for (let i = 0; i < sgfList.length; i++) {
    opts.onProgress?.(
      Math.round((i / sgfList.length) * 100),
      '分析棋谱',
      `${i + 1}/${sgfList.length}`
    );

    const sgf = sgfList[i]!;
    const parsed = parser.parse(sgf);
    const moves: RawMove[] = parsed.moves.slice(0, opts.firstN).map((m) => [m.color, m.coord]);
    const gameInfo = extractGameInfo(parsed);

    // 提取四角
    const corners = extractor.extractFourCorners(moves, opts.firstN);

    // 对每个角进行匹配
    for (const cornerKey of ['tl', 'tr', 'bl', 'br'] as const) {
      const cornerMoves = corners[cornerKey];
      if (!cornerMoves || cornerMoves.moves.length < opts.minMatchLen) continue;

      // 1. 转换到右上角
      const trMoves = convertToTopRight(
        cornerMoves.moves.map((m) => m.coord),
        cornerKey
      );

      // 2. 归一化
      const { normalized } = normalizeCornerSequence(trMoves);

      // 3. 匹配定式（异步，支持动态加载）
      const result = await matcher.match(
        normalized.map((c, i) => [i % 2 === 0 ? 'B' : 'W', c] as ['B' | 'W', string]),
        trie
      );

      if (result.matchedPath.length >= opts.minMatchLen) {
        // 4. 收集所有定式终点（多分支）
        const endpoints = await matcher.collectJosekiEndpoints(result.matchedPath, trie);
        
        // 如果没有找到任何定式终点，跳过
        if (endpoints.length === 0) {
          continue;
        }
        
        // 5. 导出定式树 SGF（多分支，主分支使用整个角的着法序列）
        const prefixStr = result.matchedPath.join(' ');
        const treeSgf = exportTreeFromEndpoints(endpoints, normalized, prefixStr);

        // 使用 endpoints 的统计数据（频率、概率、胜率）
        const totalFreq = endpoints.reduce((sum, e) => sum + e.freq, 0);
        const avgProb = endpoints.reduce((sum, e) => sum + e.prob, 0) / endpoints.length;
        
        // 收集所有胜率数据
        const winrateData = endpoints
          .filter(e => e.winrate)
          .map(e => e.winrate!);
        
        const pattern: IDiscoveredPattern = {
          prefix: result.matchedPath.join(' '),
          frequency: totalFreq,
          prefixLen: result.matchedPath.length,
          totalMoves: cornerMoves.moves.length,
          sourceCorner: cornerKey,
          probability: avgProb,
          extractedMoves: treeSgf,
          gameInfo: {
            ...gameInfo,
            sgfIndex: i,
          },
        };

        // 计算平均胜率统计
        if (winrateData.length > 0) {
          const avgDelta = winrateData.reduce((sum, w) => sum + w.delta, 0) / winrateData.length;
          const avgStddev = winrateData.filter(w => w.stddev !== undefined).length > 0
            ? winrateData.filter(w => w.stddev !== undefined).reduce((sum, w) => sum + (w.stddev || 0), 0) / winrateData.filter(w => w.stddev !== undefined).length
            : undefined;
          const totalSamples = winrateData.reduce((sum, w) => sum + (w.samples || 0), 0);
          const totalPositive = winrateData.reduce((sum, w) => sum + (w.positive || 0), 0);
          const totalNegative = winrateData.reduce((sum, w) => sum + (w.negative || 0), 0);
          const totalNeutral = winrateData.reduce((sum, w) => sum + (w.neutral || 0), 0);
          
          pattern.winrateStats = {
            delta: avgDelta,
            ...(avgStddev !== undefined && { stddev: avgStddev }),
            ...(totalSamples > 0 && { samples: totalSamples, positive: totalPositive, negative: totalNegative, neutral: totalNeutral }),
          };
          pattern.winrateDelta = avgDelta;
        }

        allPatterns.push(pattern);
      }
    }
  }

  opts.onProgress?.(100, '分析完成');

  return allPatterns.sort((a, b) => {
    // 首先按匹配长度降序
    if (b.prefixLen !== a.prefixLen) {
      return b.prefixLen - a.prefixLen;
    }
    // 相同长度，按频率降序
    return b.frequency - a.frequency;
  });
}

/**
 * 从解析结果提取棋谱信息
 */
function extractGameInfo(parsed: {
  gameInfo?: { black?: string; white?: string; date?: string };
}): { black: string; white: string; date: string } {
  const info = parsed.gameInfo ?? {};
  return {
    black: info.black ?? 'Unknown',
    white: info.white ?? 'Unknown',
    date: info.date ?? 'Unknown',
  };
}
