/**
 * @fileoverview 野狐直播棋谱提供者基类
 * @description 提供公共方法：二进制解析、让子棋提取、SGF 生成等
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { WsMessageData } from '../../../../infrastructure/network/interfaces/SnifferTypes';

/** 着法信息 */
export interface Move {
  x: number;
  y: number;
  color: 1 | 2; // 1=黑, 2=白
}

/** 让子棋信息 */
export interface HandicapInfo {
  count: number;
  stones: Array<{ x: number; y: number; color: 'B' }>; // 让子棋子总是黑棋
}

/**
 * 野狐直播提供者基类
 */
export abstract class FoxwqLiveProviderBase extends BaseProvider {
  /** URL 模式（子类共用） */
  static readonly URL_PATTERNS = [
    /h5\.foxwq\.com\/yehunewshare/i,
    /h5\.foxwq\.com.*svrtype=20010/i,
  ];

  constructor(
    network: NetworkManager,
    protected readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  // ========== 抽象方法（子类实现） ==========

  /**
   * 检测是否是自己能处理的数据类型
   * @param data WebSocket 数据
   * @returns true=能处理, false=不能处理
   */
  abstract canHandleData(data: Uint8Array): boolean;

  /**
   * 从 WebSocket 数据中提取着法
   * @param data WebSocket 数据
   * @returns 着法列表
   */
  abstract extractMoves(data: Uint8Array): Move[];

  // ========== 公共方法 ==========

  /**
   * 启动 Sniffer 并收集 WebSocket 数据
   */
  protected async collectWsMessages(
    url: string,
    timeout: number
  ): Promise<{
    success: boolean;
    messages: Uint8Array[];
    debugData: Array<{ raw: string; isBinary: boolean }>;
    error?: string;
  }> {
    if (!this.sniffer.isAvailable()) {
      return {
        success: false,
        messages: [],
        debugData: [],
        error: '该平台需要 Sniffer 支持。\n' + this.sniffer.getEnvironmentDescription(),
      };
    }

    try {
      const session = await this.sniffer.start(url, {
        timeout,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      });

      const wsMessages: Uint8Array[] = [];
      const debugData: Array<{ raw: string; isBinary: boolean }> = [];

      session.onMessage((msg) => {
        if (msg.type === 'ws_receive') {
          const wsMsg = msg as WsMessageData;
          if (wsMsg.isBinary && wsMsg.data) {
            debugData.push({ raw: wsMsg.data.substring(0, 100), isBinary: wsMsg.isBinary });

            const data = this.parseBinaryData(wsMsg.data);
            if (data) {
              wsMessages.push(data);
            }
          }
        }
      });

      const result = await session.wait(timeout);

      if (!result.success) {
        return {
          success: false,
          messages: [],
          debugData,
          error: result.error || 'Sniffer 抓取数据失败',
        };
      }

      return { success: true, messages: wsMessages, debugData };
    } catch (error) {
      return {
        success: false,
        messages: [],
        debugData: [],
        error: `抓取异常: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析二进制数据（支持多种格式）
   */
  protected parseBinaryData(data: string): Uint8Array | null {
    // 1. Base64
    try {
      if (this.isValidBase64(data)) return this.base64ToUint8Array(data);
    } catch (e) {
      console.warn('[FoxwqLive] Base64 解码失败:', e);
    }

    // 2. Hex
    try {
      if (this.isValidHexString(data)) return this.hexStringToUint8Array(data);
    } catch (e) {
      console.warn('[FoxwqLive] 十六进制解码失败:', e);
    }

    // 3. JSON Array
    try {
      if (data.startsWith('[')) return this.jsonArrayToUint8Array(data);
    } catch (e) {
      console.warn('[FoxwqLive] JSON 数组解码失败:', e);
    }

    // 4. Raw bytes
    try {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      console.log('[FoxwqLive] 使用原始字节格式，长度:', bytes.length);
      return bytes;
    } catch (e) {
      console.error('[FoxwqLive] 所有解码方式都失败:', e);
      return null;
    }
  }

  /**
   * 从 WebSocket 数据中提取棋盘状态字符串
   * @description 棋盘状态编码为 361 字符的字符串（0=空, 1=黑, 2=白）
   * 在 protobuf 中为 field 22 (tag=0xb2), wire_type=2, length=361
   * 该字符串表示最终局面，可用于校验着法解析是否正确
   */
  protected extractBoardState(data: Uint8Array): string | null {
    // 方法1：查找 protobuf field 22 (tag=0xb2) 的 length-delimited 字段
    // tag = 0xb2, length varint = 0xe9 0x02 (361), content = 361 bytes ASCII '0'/'1'/'2'
    for (let i = 0; i < data.length - 365; i++) {
      if (data[i] === 0xb2 && // tag: field 22, wire_type 2
          data[i + 1] === 0xe9 && data[i + 2] === 0x02) { // length varint = 361
        // 验证内容是否全是 ASCII '0','1','2'
        let valid = true;
        for (let j = 0; j < 361; j++) {
          const b = data[i + 3 + j];
          if (b !== 0x30 && b !== 0x31 && b !== 0x32) {
            valid = false;
            break;
          }
        }
        if (valid) {
          const boardStr = String.fromCharCode(...data.slice(i + 3, i + 3 + 361));
          console.info('[FoxwqLive] 提取到棋盘状态字符串 (protobuf field 22)');
          return boardStr;
        }
      }
    }

    // 方法2：在文本中搜索 361 字符的 012 序列（fallback）
    // 注意：文本搜索容易误匹配，需要额外验证
    const text = this.uint8ArrayToString(data);
    const matches = text.match(/[012]{361}/g);
    if (matches && matches.length > 0) {
      // 找到所有匹配，优先选择棋子分布合理的（黑白比例不能太悬殊）
      let bestMatch: string | null = null;
      for (const m of matches) {
        let b = 0, w = 0;
        for (const ch of m) { if (ch === '1') b++; else if (ch === '2') w++; }
        const ratio = b / (b + w);
        // 黑子比例在 0.35-0.65 之间比较合理（正常围棋对局）
        if (ratio > 0.35 && ratio < 0.65) {
          bestMatch = m;
          break;
        }
      }
      if (bestMatch) {
        let b = 0, w = 0;
        for (const ch of bestMatch) { if (ch === '1') b++; else if (ch === '2') w++; }
        console.info('[FoxwqLive] 提取到棋盘状态字符串 (文本搜索), 黑', b, '白', w);
        return bestMatch;
      }
      // 所有匹配都不合理，可能是误匹配
      console.warn('[FoxwqLive] 文本搜索找到', matches.length, '个匹配，但棋子分布都不合理，忽略');
    }

    return null;
  }

  /**
   * 计算棋盘快照上的棋子总数
   */
  private countStonesOnBoard(boardState: string): { black: number; white: number; total: number } {
    let black = 0;
    let white = 0;
    for (let i = 0; i < boardState.length; i++) {
      if (boardState[i] === '1') black++;
      else if (boardState[i] === '2') white++;
    }
    return { black, white, total: black + white };
  }

  /**
   * 用棋盘快照校验并截断着法
   *
   * 直播中 Sniffer 可能抓到快照之后的新 ws 包（多了几手着法），
   * 导致着法数 > 快照对应的着手数。
   *
   * 策略：逐手回放，找到与快照一致的着手数，截断后面的着法。
   * 以最终局面（快照）为准，快照后的着法是还没形成局面的新数据，直接舍弃。
   *
   * @returns 截断后的着手数（0=校验失败，null=无快照无法校验）
   */
  protected validateMovesWithBoard(moves: Move[], boardState: string | null, handicapStones?: Array<{ x: number; y: number }>): number | null {
    if (!boardState || boardState.length !== 361) {
      return null; // 无快照，无法校验
    }

    console.info('[FoxwqLive] 校验:', moves.length, '手着法 vs 快照');

    // 初始化棋盘
    const board: number[][] = Array.from({ length: 19 }, () => Array(19).fill(0));

    // 摆让子棋
    if (handicapStones && handicapStones.length > 0) {
      for (const s of handicapStones) {
        if (s.x >= 0 && s.x < 19 && s.y >= 0 && s.y < 19) {
          board[s.y]![s.x]! = 1;
        }
      }
    }

    // 逐手回放，找到与快照一致的着手数
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;
      const { x, y, color } = move;

      // Pass 不改变棋盘，但检查是否匹配快照
      if (x < 0 || y < 0) {
        const boardStr = board.map(row => row.join('')).join('');
        if (boardStr === boardState) {
          console.info('[FoxwqLive] 快照在第', i + 1, '手(Pass)后匹配，截断后', moves.length - i - 1, '手舍弃');
          return i + 1;
        }
        continue;
      }

      if (x < 0 || x >= 19 || y < 0 || y >= 19) continue;

      // 位置已被占用 → 检查当前棋盘是否已匹配快照
      if (board[y]![x]! !== 0) {
        const boardStr = board.map(row => row.join('')).join('');
        if (boardStr === boardState) {
          console.info('[FoxwqLive] 快照在第', i, '手后匹配（第', i + 1, '手位置已有子），截断后', moves.length - i, '手舍弃');
          return i;
        }
        // 不匹配，继续（提子后可能落在此处）
      }

      // 落子
      board[y]![x]! = color;

      // 提子
      const opponent = color === 1 ? 2 : 1;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const dir of dirs) {
        const dx = dir[0]!, dy = dir[1]!;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < 19 && ny >= 0 && ny < 19 && board[ny]![nx]! === opponent) {
          const group = this.getGroup(board, nx, ny, opponent);
          if (this.countLiberties(board, group) === 0) {
            for (const g of group) {
              const gx = g[0]!, gy = g[1]!;
              board[gy]![gx]! = 0;
            }
          }
        }
      }

      // 每手落子后检查是否匹配快照
      const boardStr = board.map(row => row.join('')).join('');
      if (boardStr === boardState) {
        const extraMoves = moves.length - (i + 1);
        console.info('[FoxwqLive] ✅ 快照在第', i + 1, '手后匹配', extraMoves > 0 ? '，截断后' + extraMoves + '手舍弃' : '');
        return i + 1;
      }

      // 只在匹配时才输出结果，不打逐手日志
    }

    // 全部回放完没找到匹配点
    console.warn('[FoxwqLive] 回放完毕未匹配快照，着法:', moves.length, '手');
    return moves.length;
  }

  /**
   * 获取棋子上相连的群（辅助方法）
   */
  private getGroup(board: number[][], x: number, y: number, color: number): Array<[number, number]> {
    const group: Array<[number, number]> = [];
    const visited = new Set<string>();
    const stack: Array<[number, number]> = [[x, y]];

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (cx < 0 || cx >= 19 || cy < 0 || cy >= 19) continue;
      if (board[cy]![cx]! !== color) continue;

      group.push([cx, cy]);
      stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }

    return group;
  }

  /**
   * 计算群的气数（辅助方法）
   */
  private countLiberties(board: number[][], group: Array<[number, number]>): number {
    const liberties = new Set<string>();
    for (const g of group) {
      const x = g[0]!, y = g[1]!;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const dir of dirs) {
        const dx = dir[0]!, dy = dir[1]!;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < 19 && ny >= 0 && ny < 19 && board[ny]![nx]! === 0) {
          liberties.add(`${nx},${ny}`);
        }
      }
    }
    return liberties.size;
  }

  /**
   * 提取贴目（KM）
   * @description 从 WebSocket 数据提取，或根据让子数计算
   */
  protected extractKomi(data: Uint8Array, handicap: number): number {
    // 1. 从数据中提取 KM[] 字段
    const text = this.uint8ArrayToString(data);
    const kmMatch = text.match(/KM\[([\d.]+)\]/);
    if (kmMatch && kmMatch[1]) {
      const komi = parseFloat(kmMatch[1]);
      if (!Number.isNaN(komi)) {
        console.info(`[FoxwqLive] 从数据中提取贴目: ${komi}`);
        return komi;
      }
    }

    // 2. 根据让子数计算贴目
    // 标准规则：让 N 子，贴目减少 N 目
    // 参考：services/play/hm/HMPlayService.ts
    if (handicap >= 2) {
      const baseKomi = 7.5;
      const handicapKomi = baseKomi - handicap;
      console.info(`[FoxwqLive] 让 ${handicap} 子，计算贴目: ${handicapKomi} 目`);
      return handicapKomi;
    }

    // 3. 默认贴目（分先棋）
    return 7.5;
  }

  /**
   * 提取让子棋信息
   * @description 从 WebSocket 数据中提取让子数和实际棋子位置
   */
  protected extractHandicap(data: Uint8Array, moves?: Move[]): HandicapInfo {
    // 1. 从 protobuf 中提取让子数
    let handicapCount = 0;
    for (let i = 0; i < data.length - 6; i++) {
      if (
        data[i] === 0x08 &&
        data[i + 1] === 0x13 &&
        data[i + 2] === 0x10 &&
        data[i + 3] === 0x01 &&
        data[i + 4] === 0x18
      ) {
        const h = data[i + 5];
        if (h !== undefined && h >= 2 && h <= 9) {
          handicapCount = h;
          break;
        }
      }
    }

    // 2. 从 SGF HA[] 字段中提取（fallback）
    if (handicapCount === 0) {
      const text = this.uint8ArrayToString(data);
      const haMatch = text.match(/HA\[(\d+)\]/);
      if (haMatch && haMatch[1]) {
        handicapCount = parseInt(haMatch[1], 10);
      }
    }

    // 3. 如果没有让子，返回空
    if (handicapCount === 0) {
      return { count: 0, stones: [] };
    }

    // 4. 从着法列表中提取实际让子位置（前 N 手黑棋就是让子位置）
    // 这比标准位置更准确，因为实际对局的让子位置可能不同
    if (moves && moves.length > 0) {
      const stones: Array<{ x: number; y: number; color: 'B' }> = [];
      for (const move of moves) {
        if (move.color === 1 && stones.length < handicapCount) {
          stones.push({ x: move.x, y: move.y, color: 'B' });
        }
        if (stones.length >= handicapCount) break;
      }
      if (stones.length === handicapCount) {
        console.info('[FoxwqLive] 从着法列表提取让子位置:', stones.map(s => `(${s.x},${s.y})`).join(', '));
        return { count: handicapCount, stones };
      }
    }

    // 5. 从 AB[] 字段提取（SGF 文本格式）
    const stones: Array<{ x: number; y: number; color: 'B' }> = [];
    const text = this.uint8ArrayToString(data);
    const abMatch = text.match(/AB\[([^\]]+)\]/);
    if (abMatch && abMatch[1]) {
      const coords = abMatch[1].match(/[a-z]{2}/g);
      if (coords) {
        coords.forEach(coord => {
          if (coord.length === 2) {
            const x = coord.charCodeAt(0) - 97;
            const y = coord.charCodeAt(1) - 97;
            if (x >= 0 && x < 19 && y >= 0 && y < 19) {
              stones.push({ x, y, color: 'B' });
            }
          }
        });
      }
    }

    // 6. 如果都没找到，使用标准让子位置（最后手段）
    if (stones.length === 0 && handicapCount > 0) {
      const standardPositions = this.getStandardHandicapCoords(handicapCount);
      stones.push(...standardPositions.map(({ x, y }) => ({ x, y, color: 'B' as const })));
      console.info('[FoxwqLive] 使用标准让子位置:', handicapCount, '子（可能与实际不同）');
    }

    return { count: handicapCount, stones };
  }

  /**
   * 获取标准让子位置（星位）
   */
  protected getStandardHandicapCoords(handicap: number): Array<{ x: number; y: number }> {
    const coords: Record<number, Array<{ x: number; y: number }>> = {
      2: [
        { x: 3, y: 3 },   // D4 (左上星)
        { x: 15, y: 15 }, // P16 (右下星)
      ],
      3: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },  // D16 (左下星)
      ],
      4: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },  // P4 (右上星)
      ],
      5: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 9 },   // J10 (天元)
      ],
      6: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 3 },   // J4
        { x: 9, y: 15 },  // J16
      ],
      7: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 3 },
        { x: 9, y: 15 },
        { x: 9, y: 9 },
      ],
      8: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 3 },
        { x: 9, y: 15 },
        { x: 3, y: 9 },   // D10
        { x: 15, y: 9 },  // P10
      ],
      9: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 3 },
        { x: 9, y: 15 },
        { x: 3, y: 9 },
        { x: 15, y: 9 },
        { x: 9, y: 9 },
      ],
    };
    return coords[handicap] || [];
  }

  /**
   * 提取玩家名字
   */
  protected extractPlayerNames(data: Uint8Array): [string, string] {
    const names: string[] = [];
    try {
      // 查找玩家名字：protobuf field 2 (0x12) 或 field 3 (0x1a) length-delimited
      for (let i = 0; i < data.length - 3; i++) {
        if (data[i] === 0x12 || data[i] === 0x1a) {
          const strLen = data[i + 1];
          if (strLen !== undefined && 2 <= strLen && strLen <= 20 && i + 2 + strLen <= data.length) {
            try {
              const nameBytes = data.slice(i + 2, i + 2 + strLen);
              const name = this.uint8ArrayToString(nameBytes);

              // 过滤条件
              if (name &&
                  name.length >= 2 &&
                  name.length <= 20 &&
                  !name.startsWith('http') &&
                  !name.match(/^[\d.]+$/) &&
                  name !== 'avatar' &&
                  name !== 'foxwq' &&
                  name !== 'com' &&
                  name !== 'avata' &&
                  name !== 'jpg') {

                // 中文名或韩文名
                if (name.match(/[\u4e00-\u9fff\uAC00-\uD7AF]/)) {
                  const cleanChars = name.split('').filter(c => {
                    const code = c.charCodeAt(0);
                    return (code >= 0x4e00 && code <= 0x9fff) ||  // 中文
                           (code >= 0xAC00 && code <= 0xD7AF) ||  // 韩文音节
                           (code >= 0x30 && code <= 0x39) ||       // 数字
                           (code >= 0x41 && code <= 0x5a) ||       // 大写英文
                           (code >= 0x61 && code <= 0x7a) ||       // 小写英文
                           code === 0x20 || code === 0x5f;        // 空格、下划线
                  });
                  if (cleanChars.length >= name.length * 0.7) {
                    names.push(name);
                  }
                }
                // 英文名
                else if (name.match(/^[a-zA-Z][a-zA-Z0-9]*$/)) {
                  names.push(name);
                }
              }
            } catch {}
          }
        }
      }

      // Fallback: 从文本中查找
      if (names.length < 2) {
        const text = this.uint8ArrayToString(data);
        const matches = text.match(/([\w\u4e00-\u9fff\uAC00-\uD7AF]+)\[\d+段\]/g);
        if (matches) {
          matches.forEach((m) => {
            const nameMatch = m.match(/([\w\u4e00-\u9fff\uAC00-\uD7AF]+)\[/);
            if (nameMatch && nameMatch[1]) names.push(nameMatch[1]);
          });
        }

        if (names.length < 2) {
          const namePattern = /[a-zA-Z][a-zA-Z0-9]{1,14}|[\u4e00-\u9fff]{2,15}|[\uAC00-\uD7AF]{2,15}/g;
          const allNames = text.match(namePattern) || [];

          const scoredNames = allNames.map(name => {
            let score = 0;
            if (name.match(/[\u4e00-\u9fff\uAC00-\uD7AF]/)) score += 100;
            if (name.match(/[a-zA-Z]+[0-9]+/)) score += 50;
            if (name.length >= 4) score += 20;
            if (name.length >= 6) score += 10;

            const excluded = ['http', 'https', 'www', 'com', 'avata', 'avatar',
                            'foxwq', 'jpg', 'gif', 'png', 'headimg', 'fX', 'Rj'];
            if (excluded.includes(name)) score = -1;
            if (name.match(/^[0-9]+$/)) score = -1;

            return { name, score };
          }).filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);

          for (const item of scoredNames) {
            if (names.length >= 2) break;
            if (!names.includes(item.name)) {
              names.push(item.name);
            }
          }
        }
      }

      const uniqueNames = [...new Set(names)];
      return [uniqueNames[0] || '黑棋', uniqueNames[1] || '白棋'];
    } catch {
      return ['黑棋', '白棋'];
    }
  }

  /**
   * 提取游戏结果
   */
  protected extractGameResult(data: Uint8Array): string | null {
    try {
      // 搜索 opType=403 的 varint 编码 (0x93 0x03)
      for (let i = 0; i < data.length - 6; i++) {
        if (data[i] === 0x93 && data[i + 1] === 0x03 && data[i + 2] === 0x1a) {
          const msgLen = data[i + 3];
          if (msgLen === undefined || msgLen < 4 || i + 4 + msgLen > data.length) continue;

          let winner = 0;
          let points = 0;
          let reason = 0;
          const msgStart = i + 4;
          const msgEnd = msgStart + msgLen;
          for (let j = msgStart; j < msgEnd - 1; j++) {
            if (data[j] === 0x10) { winner = data[j + 1] || 0; }
            if (data[j] === 0x18) { points = data[j + 1] || 0; }
            if (data[j] === 0x20) { reason = data[j + 1] || 0; }
          }

          if (winner > 0) {
            const winnerStr = winner === 1 ? 'B' : 'W';
            if (reason === 1) return `${winnerStr}+R`;
            if (reason === 2) return `${winnerStr}+T`;
            if (points > 0) return `${winnerStr}+${points}`;
            // points=0 且有胜方，可能是数子结果差为0（和棋）
            return '0';
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 生成 SGF
   */
  protected createSgf(
    moves: Move[],
    playerNames: [string, string],
    handicap: HandicapInfo,
    komi: number,
    result: string | null = null
  ): string {
    if (moves.length === 0) return '';

    const coordMap = 'abcdefghijklmnopqrs';
    let sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]\n';
    sgf += `PB[${playerNames[0]}]PW[${playerNames[1]}]\n`;
    
    // 设置贴目（关键！）
    sgf += `KM[${komi}]\n`;

    if (result) {
      sgf += `RE[${result}]\n`;
    }

    // 构建让子位置集合，用于过滤着法列表中的让子棋子
    const handicapSet = new Set<string>();
    if (handicap.count > 0 && handicap.stones.length > 0) {
      sgf += `HA[${handicap.count}]\n`;
      sgf += 'AB';
      handicap.stones.forEach(({ x, y }) => {
        sgf += `[${coordMap[x]}${coordMap[y]}]`;
        handicapSet.add(`${x},${y}`);
      });
      sgf += '\n';
    }

    // 添加着法（跳过与让子位置重复的黑棋）
    let handicapSkipped = 0;
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;

      const { x, y, color } = move;

      // 让子棋：跳过前几步在让子位置上的黑棋（已在AB[]中摆放）
      if (handicap.count > 0 && color === 1 && handicapSet.has(`${x},${y}`) && handicapSkipped < handicap.count) {
        handicapSkipped++;
        continue;
      }

      // 让子棋：白先（白棋第一手）
      // 非让子棋：黑先（黑棋第一手）
      // 但是！我们优先使用实际颜色信息（从 WebSocket 数据中提取）
      // color: 1=黑, 2=白

      const colorStr = color === 1 ? 'B' : 'W';

      if (0 <= x && x < 19 && 0 <= y && y < 19) {
        sgf += `;${colorStr}[${coordMap[x]}${coordMap[y]}]\n`;
      }
    }

    sgf += ')';
    return sgf;
  }

  /**
   * 解析 SGF 元数据
   */
  protected parseSgfMetadata(sgf: string): GameMetadata {
    const getTag = (tag: string): string => {
      const match = sgf.match(new RegExp(`${tag}\\[([^\\]]*)\\]`));
      return match && match[1] ? match[1] : '';
    };

    return {
      source: this.name,
      gameId: getTag('GC') || '',
      blackName: getTag('PB') || '黑方',
      whiteName: getTag('PW') || '白方',
      width: parseInt(getTag('SZ') || '19', 10),
      height: parseInt(getTag('SZ') || '19', 10),
      komi: parseFloat(getTag('KM') || '6.5'),
      handicap: parseInt(getTag('HA') || '0', 10),
      rules: getTag('RU') || 'chinese',
      date: getTag('DT') || '',
      result: getTag('RE') || '',
      movesCount: this.countMoves(sgf),
    };
  }

  // ========== 工具方法 ==========

  protected isValidBase64(str: string): boolean {
    if (!/^[A-Za-z0-9+/]+=*$/.test(str)) return false;
    if (str.includes('=')) {
      const paddingLength = str.length - str.indexOf('=');
      return paddingLength <= 2;
    }
    return str.length > 0;
  }

  protected isValidHexString(str: string): boolean {
    return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
  }

  protected base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  protected hexStringToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    return bytes;
  }

  protected jsonArrayToUint8Array(json: string): Uint8Array {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) throw new Error('不是数组');
    return new Uint8Array(arr);
  }

  protected concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  protected containsBytes(data: Uint8Array, pattern: number[]): boolean {
    for (let i = 0; i <= data.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (data[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  protected uint8ArrayToString(bytes: Uint8Array): string {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  }

  private countMoves(sgf: string): number {
    const matches = sgf.match(/[BW]\\[[^\\]]*\\]/g);
    return matches ? matches.length : 0;
  }
}
