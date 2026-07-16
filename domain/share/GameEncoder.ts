/**
 * 棋谱编码器
 * 将棋谱编码为紧凑二进制格式（每手2字节）
 * @module domain/share/GameEncoder
 */

/**
 * 编码后的单手棋
 */
export interface EncodedMove {
  /** 颜色：B=黑, W=白 */
  color: 'B' | 'W';
  /** X坐标 (0-18 for 19x19) */
  x: number;
  /** Y坐标 (0-18 for 19x19) */
  y: number;
}

/**
 * 解码后的棋谱数据
 */
export interface DecodedGame {
  /** 棋盘大小 */
  boardSize: number;
  /** 让子数 */
  handicap: number;
  /** 手数列表 */
  moves: EncodedMove[];
}

/**
 * 棋谱编码器
 *
 * 将棋谱编码为紧凑二进制格式：
 * - 文件头：4字节（Magic + Version + BoardSize + Handicap）
 * - 每手棋：2字节（Color 1bit + X 7bit, Y 8bit）
 *
 * 编码后使用 Base64 URL-safe 格式，适合在 URL 参数中传递
 */
export class GameEncoder {
  private static MAGIC = 0x57; // 'W' for Weiqi
  private static VERSION = 0x01;

  /**
   * 编码棋谱为 Base64 URL-safe 字符串
   * @param moves - 手数列表
   * @param boardSize - 棋盘大小，默认19
   * @param handicap - 让子数，默认0
   * @returns 编码后的字符串，无手数返回null
   */
  static encode(moves: EncodedMove[], boardSize = 19, handicap = 0): string | null {
    if (moves.length === 0) return null;

    // 文件头: Magic(1) + Version(1) + BoardSize(1) + Handicap(1)
    const header = new Uint8Array([this.MAGIC, this.VERSION, boardSize, handicap]);

    // 手数数据: 每手2字节 (Color 1bit + X 7bit, Y 8bit)
    const data = new Uint8Array(moves.length * 2);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      const color = m.color === 'W' ? 1 : 0;
      data[i * 2] = (color << 7) | (m.x & 0x7F);
      data[i * 2 + 1] = m.y & 0xFF;
    }

    // 合并
    const compact = new Uint8Array(header.length + data.length);
    compact.set(header);
    compact.set(data, header.length);

    // Base64 URL-safe 编码
    return this.base64UrlSafeEncode(compact);
  }

  /**
   * 解码 Base64 为棋谱数据
   * @param base64 - 编码后的字符串
   * @returns 棋谱数据，失败返回null
   */
  static decode(base64: string): DecodedGame | null {
    try {
      const binary = this.base64UrlSafeDecode(base64);

      // 解析文件头
      const magic = binary[0];
      const version = binary[1];
      const boardSize = binary[2];
      const handicap = binary[3];

      if (magic !== this.MAGIC) {
        throw new Error('Invalid data format');
      }

      // 解析手数
      const moves: EncodedMove[] = [];
      for (let i = 4; i < binary.length; i += 2) {
        if (i + 1 >= binary.length) break;
        const byte0 = binary[i]!;
        const byte1 = binary[i + 1]!;
        const color = (byte0 & 0x80) ? 'W' : 'B';
        const x = byte0 & 0x7F;
        const y = byte1;
        moves.push({ color, x, y });
      }

      return { boardSize: boardSize ?? 19, handicap: handicap ?? 0, moves };
    } catch {
      return null;
    }
  }

  /**
   * 棋谱数据转 SGF 格式
   * @param game - 解码后的棋谱数据
   * @returns SGF格式字符串
   */
  static toSGF(game: DecodedGame): string {
    const coords = 'abcdefghijklmnopqrs'; // 19 chars for 19x19
    let sgf = `(;GM[1]FF[4]SZ[${game.boardSize}]CA[UTF-8]AP[WeiqiRecorder]KM[0]`;

    for (const move of game.moves) {
      const coord = (coords[move.x] ?? 'a') + (coords[move.y] ?? 'a');
      sgf += `;${move.color}[${coord}]`;
    }

    sgf += ')';
    return sgf;
  }

  /**
   * Base64 URL-safe 编码
   */
  private static base64UrlSafeEncode(data: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...Array.from(data)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Base64 URL-safe 解码
   */
  private static base64UrlSafeDecode(base64: string): Uint8Array {
    const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  }
}
