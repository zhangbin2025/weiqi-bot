/**
 * @fileoverview 野狐直播棋谱提供者（使用 Sniffer 监听 WebSocket）
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { WsMessageData } from '../../../../infrastructure/network/interfaces/SnifferTypes';

export class FoxwqLiveProvider extends BaseProvider {
  readonly name = 'foxwq-live';
  readonly displayName = '野狐围棋（直播）';
  readonly urlPatterns = [
    /h5\.foxwq\.com\/yehunewshare/i,
    /h5\.foxwq\.com.*svrtype=20010/i,
  ];

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetch(url: string, options?: { timeout?: number }): Promise<FetchResult> {
    const timeout = options?.timeout ?? 15000;
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    if (!this.sniffer.isAvailable()) {
      return this.createErrorResult(
        url,
        '该平台需要 Sniffer 支持。\n' + this.sniffer.getEnvironmentDescription(),
        timing
      );
    }

    try {
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      });

      const wsMessages: Uint8Array[] = [];
      let isJueyi = false;
      const debugData: Array<{ raw: string; isBinary: boolean }> = [];

      session.onMessage((msg) => {
        if (msg.type === 'ws_receive') {
          const wsMsg = msg as WsMessageData;
          if (wsMsg.isBinary && wsMsg.data) {
            debugData.push({ raw: wsMsg.data.substring(0, 100), isBinary: wsMsg.isBinary });

            const data = this.parseBinaryData(wsMsg.data);
            if (data) {
              wsMessages.push(data);
              if (!isJueyi && this.isJueyiLiveData(data)) {
                isJueyi = true;
              }
            }
          }
        }
      });

      const result = await session.wait(timeout);
      timing.apiRequest = this.now() - fetchStart;

      if (!result.success) {
        return this.createErrorResult(url, result.error || 'Sniffer 抓取数据失败', timing);
      }

      if (wsMessages.length === 0) {
        console.error('[FoxwqLiveProvider] 未捕获到有效数据，原始数据样本:', debugData.slice(0, 3));
        return this.createErrorResult(url, '未捕获到 WebSocket 数据', timing);
      }

      const combinedData = this.concatUint8Arrays(wsMessages);
      console.log(`[FoxwqLiveProvider] 捕获到 ${wsMessages.length} 条消息，总长度 ${combinedData.length} 字节`);

      const sgfStart = this.now();
      const sgfContent = isJueyi
        ? this.parseJueyiLiveSgf(combinedData)
        : this.parseNormalLiveSgf(combinedData);
      timing.sgfGeneration = this.now() - sgfStart;

      if (!sgfContent) {
        return this.createErrorResult(url, '无法从 WebSocket 数据中提取棋谱', timing);
      }

      const metadata = this.parseSgfMetadata(sgfContent);
      metadata.source = this.name;
      timing.total = this.now() - startTime;

      return { success: true, source: this.name, url, sgfContent, metadata, timing };
    } catch (error) {
      return this.createErrorResult(
        url,
        `获取失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }

  private parseBinaryData(data: string): Uint8Array | null {
    // 1. Base64
    try {
      if (this.isValidBase64(data)) return this.base64ToUint8Array(data);
    } catch (e) {
      console.warn('[FoxwqLiveProvider] Base64 解码失败:', e);
    }

    // 2. Hex
    try {
      if (this.isValidHexString(data)) return this.hexStringToUint8Array(data);
    } catch (e) {
      console.warn('[FoxwqLiveProvider] 十六进制解码失败:', e);
    }

    // 3. JSON Array
    try {
      if (data.startsWith('[')) return this.jsonArrayToUint8Array(data);
    } catch (e) {
      console.warn('[FoxwqLiveProvider] JSON 数组解码失败:', e);
    }

    // 4. Raw bytes
    try {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      console.log('[FoxwqLiveProvider] 使用原始字节格式，长度:', bytes.length);
      return bytes;
    } catch (e) {
      console.error('[FoxwqLiveProvider] 所有解码方式都失败:', e);
      return null;
    }
  }

  private isValidBase64(str: string): boolean {
    if (!/^[A-Za-z0-9+/]+=*$/.test(str)) return false;
    if (str.includes('=')) {
      const paddingLength = str.length - str.indexOf('=');
      return paddingLength <= 2;
    }
    return str.length > 0;
  }

  private isValidHexString(str: string): boolean {
    return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  private hexStringToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    return bytes;
  }

  private jsonArrayToUint8Array(json: string): Uint8Array {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) throw new Error('不是数组');
    return new Uint8Array(arr);
  }

  private concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  private isJueyiLiveData(data: Uint8Array): boolean {
    const jueyiBytes = [0x6a, 0x75, 0x65, 0x79, 0x69];
    if (this.containsBytes(data, jueyiBytes)) return true;
    const mainBranchMarker = [0x10, 0xcb, 0x01];
    if (this.containsBytes(data, mainBranchMarker)) return true;
    return false;
  }

  private containsBytes(data: Uint8Array, pattern: number[]): boolean {
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

  private parseNormalLiveSgf(data: Uint8Array): string | null {
    const moves = this.extractMovesFromBinary(data);
    if (moves.length === 0) return null;
    const playerNames = this.extractPlayerNames(data);
    const handicap = this.extractHandicap(data);
    return this.createSgf(moves, playerNames, handicap);
  }

  private parseJueyiLiveSgf(data: Uint8Array): string | null {
    const moves = this.extractJueyiLiveMoves(data);
    if (moves.length === 0) return null;
    const playerNames = this.extractPlayerNames(data);
    const handicap = this.extractHandicap(data);
    return this.createSgf(moves, playerNames, handicap);
  }

  private extractMovesFromBinary(data: Uint8Array): Array<{ x: number; y: number }> {
    const moves: Array<{ x: number; y: number }> = [];
    let i = 0;
    while (i < data.length - 4) {
      if (data[i] === 0x08 && data[i + 2] === 0x10) {
        const x = data[i + 1];
        const y = data[i + 3];
        if (x !== undefined && y !== undefined && x < 19 && y < 19) {
          moves.push({ x, y });
          i += 4;
          continue;
        }
      }
      i++;
    }
    return moves;
  }

  private extractJueyiLiveMoves(data: Uint8Array): Array<{ x: number; y: number }> {
    const moves: Array<{ x: number; y: number }> = [];
    const mainBranchMarker = [0x10, 0xcb, 0x01];
    let pos = 0;
    while (pos <= data.length - mainBranchMarker.length) {
      let found = false;
      for (let i = pos; i <= data.length - mainBranchMarker.length; i++) {
        if (
          data[i] === mainBranchMarker[0] &&
          data[i + 1] === mainBranchMarker[1] &&
          data[i + 2] === mainBranchMarker[2]
        ) {
          pos = i;
          found = true;
          break;
        }
      }
      if (!found) break;
      const start = pos + mainBranchMarker.length;
      const segment = data.slice(start, start + 20);
      if (segment.length < 8) {
        pos += 1;
        continue;
      }
      const move = this.parseMovePattern(segment);
      if (move) moves.push(move);
      pos += 1;
    }
    return moves;
  }

  private parseMovePattern(segment: Uint8Array): { x: number; y: number } | null {
    for (let i = 0; i < segment.length - 7; i++) {
      if (segment[i] === 0x08 && segment[i + 2] === 0x10 && segment[i + 4] === 0x18) {
        const x = segment[i + 1];
        const y = segment[i + 3];
        const color = segment[i + 5];
        if (
          x !== undefined &&
          y !== undefined &&
          color !== undefined &&
          x < 19 &&
          y < 19 &&
          (color === 1 || color === 2)
        ) {
          return { x, y };
        }
      }
    }
    return null;
  }

  private extractHandicap(data: Uint8Array): number {
    try {
      for (let i = 0; i < data.length - 6; i++) {
        if (
          data[i] === 0x08 &&
          data[i + 1] === 0x13 &&
          data[i + 2] === 0x10 &&
          data[i + 3] === 0x01 &&
          data[i + 4] === 0x18
        ) {
          const handicap = data[i + 5];
          if (handicap !== undefined && handicap >= 2 && handicap <= 9) return handicap;
        }
      }
      const text = this.uint8ArrayToString(data);
      const haMatch = text.match(/HA\[(\d+)\]/);
      if (haMatch && haMatch[1]) return parseInt(haMatch[1], 10);
      return 0;
    } catch {
      return 0;
    }
  }

  private extractPlayerNames(data: Uint8Array): [string, string] {
    const names: string[] = [];
    try {
      let idx = 0;
      while (idx < data.length - 3) {
        if (data[idx] === 0x9a && data[idx + 1] === 0x01) {
          const strLen = data[idx + 2];
          if (strLen !== undefined && 3 <= strLen && strLen <= 20 && idx + 3 + strLen <= data.length) {
            try {
              const nameBytes = data.slice(idx + 3, idx + 3 + strLen);
              const name = this.uint8ArrayToString(nameBytes);
              if (name && !name.startsWith('http') && name.length > 1 && !name.match(/^[\d.]+$/) && name !== 'avatar') {
                names.push(name);
              }
            } catch {}
          }
        }
        idx++;
      }
      if (names.length < 2) {
        const text = this.uint8ArrayToString(data);
        const matches = text.match(/([\w\u4e00-\u9fff]+)\[\d+段\]/g);
        if (matches) {
          matches.forEach((m) => {
            const nameMatch = m.match(/([\w\u4e00-\u9fff]+)\[/);
            if (nameMatch && nameMatch[1]) names.push(nameMatch[1]);
          });
        }
      }
      const uniqueNames = [...new Set(names)];
      return [uniqueNames[0] || '黑棋', uniqueNames[1] || '白棋'];
    } catch {
      return ['黑棋', '白棋'];
    }
  }

  private uint8ArrayToString(bytes: Uint8Array): string {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  }

  private createSgf(
    moves: Array<{ x: number; y: number }>,
    playerNames: [string, string],
    handicap: number
  ): string {
    if (moves.length === 0) return '';
    const coordMap = 'abcdefghijklmnopqrs';
    let sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]\n';
    sgf += `PB[${playerNames[0]}]PW[${playerNames[1]}]\n`;
    if (handicap >= 2) {
      sgf += `HA[${handicap}]\n`;
      const handicapCoords = this.getHandicapCoords(handicap);
      handicapCoords.forEach(({ x, y }) => {
        sgf += `;AB[${coordMap[x]}${coordMap[y]}]\n`;
      });
    }
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (!move) continue;
      const { x, y } = move;
      const color = handicap >= 2 ? (i % 2 === 0 ? 'W' : 'B') : i % 2 === 0 ? 'B' : 'W';
      if (0 <= x && x < 19 && 0 <= y && y < 19) {
        sgf += `;${color}[${coordMap[x]}${coordMap[y]}]\n`;
      }
    }
    sgf += ')';
    return sgf;
  }

  private getHandicapCoords(handicap: number): Array<{ x: number; y: number }> {
    const coords: Record<number, Array<{ x: number; y: number }>> = {
      2: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
      ],
      3: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
      ],
      4: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
      ],
      5: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 9 },
      ],
      6: [
        { x: 3, y: 3 },
        { x: 15, y: 15 },
        { x: 3, y: 15 },
        { x: 15, y: 3 },
        { x: 9, y: 3 },
        { x: 9, y: 15 },
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
        { x: 3, y: 9 },
        { x: 15, y: 9 },
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

  private parseSgfMetadata(sgf: string): GameMetadata {
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

  private countMoves(sgf: string): number {
    const matches = sgf.match(/[BW]\[[^\]]*\]/g);
    return matches ? matches.length : 0;
  }
}
