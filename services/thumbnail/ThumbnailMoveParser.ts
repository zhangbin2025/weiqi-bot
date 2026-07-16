/**
 * 缩略图着法解析器
 * 支持 JSON、SGF、坐标字符串格式
 * @module services/thumbnail/ThumbnailMoveParser
 */

import type { ThumbnailMove } from './types';
import { SGFParser, coordToPos } from '../../domain/sgf/SGFParser';

/** 着法解析器 */
export class ThumbnailMoveParser {
  /**
   * 解析着法数据
   * 支持 JSON、SGF、坐标字符串格式
   */
  parse(data: string): ThumbnailMove[] {
    if (!data) return [];

    // JSON 格式
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter((m): m is ThumbnailMove =>
          typeof m.x === 'number' && typeof m.y === 'number' &&
          (m.color === 'black' || m.color === 'white')
        );
      }
    } catch {
      // 不是 JSON，尝试其他格式
    }

    // SGF 格式 - 复用 Domain 层 SGFParser
    if (data.includes(';') && (data.includes('B[') || data.includes('W['))) {
      return this.parseSgf(data);
    }

    // 坐标字符串格式
    return this.parseCoords(data);
  }

  /**
   * 解析 SGF 格式
   * 复用 Domain 层 SGFParser
   */
  private parseSgf(sgf: string): ThumbnailMove[] {
    const parser = new SGFParser();
    const result = parser.parse(sgf);

    return result.moves
      .map(m => {
        // 特殊处理 pass 坐标
        if (m.coord === 'tt' || m.coord === 'aa') {
          return {
            x: -1,
            y: -1,
            color: m.color === 'B' ? 'black' : 'white' as const,
            isPass: true,
          };
        }

        const pos = coordToPos(m.coord);
        // 验证坐标有效性
        if (!pos || pos.x < 0 || pos.x >= 19 || pos.y < 0 || pos.y >= 19) {
          return null;
        }

        return {
          x: pos.x,
          y: pos.y,
          color: m.color === 'B' ? 'black' : 'white' as const,
          isPass: false,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null) as ThumbnailMove[];
  }

  /**
   * 解析坐标字符串格式
   */
  private parseCoords(movesStr: string): ThumbnailMove[] {
    const moves: ThumbnailMove[] = [];
    const coords = movesStr.trim().split(/\s+/);

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i]!;
      if (coord.length === 2) {
        const x = coord.charCodeAt(0) - 97;
        const y = coord.charCodeAt(1) - 97;
        if (x >= 0 && x < 19 && y >= 0 && y < 19) {
          moves.push({
            x,
            y,
            color: i % 2 === 0 ? 'black' : 'white',
            isPass: false,
          });
        }
      }
    }
    return moves;
  }
}
