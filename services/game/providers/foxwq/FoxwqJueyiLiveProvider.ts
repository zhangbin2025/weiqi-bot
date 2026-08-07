/**
 * @fileoverview 野狐直播棋谱提供者（Protobuf 协议版）
 * @description 基于 JS 源码中的 Protobuf 定义，严格按协议解码 WebSocket 二进制消息
 * 
 * 协议链：
 * 1. NetMessage$1.extractFromBytes → { msgTypeID, rawProto }
 * 2. msgTypeID==26200 → FGWHead.decode → { messageId, serverType }
 * 3. messageId==108 → EnterRoomWithoutLoginResponse.decode → roomDetail.opList
 * 4. opType==107 → StartSetPieceNotify → { gameRule, gameUsers, stoneMoves }
 * 5. opType==203 → SetPieceNotify → { x, y, color }
 * 6. opType==403 → SetGameResultNotify → { winner, points, reason }
 * 7. opType==609 → 绝艺AI胜率分析
 */

import { FoxwqLiveProviderBase, type Move } from './FoxwqLiveProviderBase';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import {
  decodeLiveGameDataFromMessages,
  type LiveGameData,
} from './FoxwqProtoDecoder';
import { komiFromProto } from '../../../../domain/game/KomiNormalizer';

/**
 * 野狐直播提供者（Protobuf 协议版）
 * 
 * 使用 Protobuf 协议严格解码，不再依赖二进制模式匹配
 */
export class FoxwqJueyiLiveProvider extends FoxwqLiveProviderBase {
  readonly name = 'foxwq-live';
  readonly displayName = '野狐围棋（直播）';
  readonly urlPatterns = FoxwqLiveProviderBase.URL_PATTERNS;

  constructor(network: NetworkManager, sniffer: ISnifferProvider) {
    super(network, sniffer);
  }

  /**
   * 检测是否能处理此数据
   * @description 尝试 Protobuf 解码，成功则能处理
   */
  canHandleData(data: Uint8Array): boolean {
    const result = decodeLiveGameDataFromMessages([data]);
    return result !== null;
  }

  /**
   * 提取着法（使用 Protobuf 协议解码）
   */
  extractMoves(data: Uint8Array): Move[] {
    const gameData = decodeLiveGameDataFromMessages([data]);
    if (!gameData) return [];

    const moves: Move[] = [];

    // 先加 StartSetPieceNotify 的棋子（让子等）
    for (const sm of gameData.stoneMoves) {
      if (sm.x >= 0 && sm.x < 19 && sm.y >= 0 && sm.y < 19 && (sm.color === 1 || sm.color === 2)) {
        moves.push({ x: sm.x, y: sm.y, color: sm.color as 1 | 2 });
      }
    }

    // 再加 SetPieceNotify 的落子
    for (const sp of gameData.setPieceMoves) {
      if (sp.x >= 0 && sp.x < 19 && sp.y >= 0 && sp.y < 19 && (sp.color === 1 || sp.color === 2)) {
        moves.push({ x: sp.x, y: sp.y, color: sp.color as 1 | 2 });
      }
    }

    return moves;
  }

  /**
   * 抓取棋谱
   */
  async fetch(url: string, options?: { timeout?: number }): Promise<FetchResult> {
    const timeout = options?.timeout ?? 5000;
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 1. 收集 WebSocket 数据
    const collectResult = await this.collectWsMessages(url, timeout);
    if (!collectResult.success) {
      return this.createErrorResult(url, collectResult.error || '抓取失败', timing);
    }

    const { messages, debugData } = collectResult;

    if (messages.length === 0) {
      console.error('[FoxwqLive] 未捕获到有效数据，原始数据样本:', debugData.slice(0, 3));
      return this.createErrorResult(url, '未捕获到 WebSocket 数据', timing);
    }

    // 2. 合并数据
    const combinedData = this.concatUint8Arrays(messages);
    console.log('[FoxwqLive] 捕获到', messages.length, '条消息，总长度', combinedData.length, '字节');

    // 3. 使用 Protobuf 协议解码
    const sgfStart = this.now();
    const gameData = decodeLiveGameDataFromMessages(messages);

    if (!gameData) {
      // Fallback: 尝试合并数据解码
      const fallbackData = decodeLiveGameDataFromMessages([combinedData]);
      if (!fallbackData) {
        return this.createErrorResult(url, 'Protobuf 协议解码失败，未找到有效的直播棋谱数据', timing);
      }
      return this.buildResultFromGameData(url, fallbackData, timing, sgfStart, startTime);
    }

    return this.buildResultFromGameData(url, gameData, timing, sgfStart, startTime);
  }

  /**
   * 从 Protobuf 解码数据构建结果
   */
  private buildResultFromGameData(
    url: string,
    gameData: LiveGameData,
    timing: PerformanceTiming,
    sgfStart: number,
    startTime: number
  ): FetchResult {
    // 提取着法
    const moves = this.extractMovesFromGameData(gameData);

    if (moves.length === 0) {
      return this.createErrorResult(url, 'Protobuf 解码成功但无着法数据', timing);
    }

    // 提取玩家名字
    const playerNames = this.extractPlayerNamesFromGameData(gameData);

    // 提取让子信息
    const handicap = this.extractHandicapFromGameData(gameData, moves);

    // 贴目
    const komi = this.extractKomiFromGameData(gameData, handicap.count);

    // 游戏结果
    const result = this.extractResultFromGameData(gameData);

    // 棋盘校验：悔棋操作已在 protobuf 解码时处理（opType=213）
    const validMoveCount = moves.length;

    // 生成 SGF
    const sgfContent = this.createSgf(moves, playerNames, handicap, komi, result);
    timing.sgfGeneration = this.now() - sgfStart;

    if (!sgfContent) {
      return this.createErrorResult(url, '无法生成 SGF', timing);
    }

    // 解析元数据
    const metadata = this.parseSgfMetadata(sgfContent);
    metadata.source = this.name;
    metadata.isLive = true;
    metadata.isEnded = !!metadata.result;
    timing.total = this.now() - startTime;

    console.info('[FoxwqLive] ✅ Protobuf 解码成功:', moves.length, '手，让子:', handicap.count,
      '绝艺AI:', gameData.aiAnalysisCount, '条');

    return { success: true, source: this.name, url, sgfContent, metadata, timing };
  }

  // ========== 从 LiveGameData 提取信息 ==========

  private extractMovesFromGameData(gameData: LiveGameData): Move[] {
    const moves: Move[] = [];

    // StartSetPieceNotify 的棋子（让子等）
    for (const sm of gameData.stoneMoves) {
      if (sm.x >= 0 && sm.x < 19 && sm.y >= 0 && sm.y < 19 && (sm.color === 1 || sm.color === 2)) {
        moves.push({ x: sm.x, y: sm.y, color: sm.color as 1 | 2 });
      }
    }

    // SetPieceNotify 的落子
    // 直播间进入时会重播所有着法，但第一条可能是"当前最后落子位置"的重复标记
    // 表现为前两手同色（如 B[qd] B[pd]），此时第一手多余，应替换为第二手
    const spMoves = gameData.setPieceMoves.filter(
      sp => sp.x >= 0 && sp.x < 19 && sp.y >= 0 && sp.y < 19 && (sp.color === 1 || sp.color === 2)
    );

    // 检测连续同色：非让子棋中着法应严格交替 B/W/B/W
    const isHandicap = (gameData.gameRule?.handicap ?? 0) > 0;

    for (const sp of spMoves) {
      if (!isHandicap && moves.length > 0 && sp.color === moves[moves.length - 1]!.color) {
        // 当前着法与上一手同色，上一手是多余的"标记"，替换为当前着法
        const coordMap = "abcdefghijklmnopqrs";
        console.info("[FoxwqLive] 替换重复着法: " + (sp.color === 1 ? "B" : "W") + "[" + coordMap[moves[moves.length - 1]!.x] + coordMap[moves[moves.length - 1]!.y] + "] -> " + (sp.color === 1 ? "B" : "W") + "[" + coordMap[sp.x] + coordMap[sp.y] + "]");
        moves[moves.length - 1] = { x: sp.x, y: sp.y, color: sp.color as 1 | 2 };
        continue;
      }

      moves.push({ x: sp.x, y: sp.y, color: sp.color as 1 | 2 });
    }

    return moves;
  }

  private extractPlayerNamesFromGameData(gameData: LiveGameData): [string, string] {
    if (gameData.gameUsers.length >= 2) {
      const black = gameData.gameUsers.find(u => u.stoneColor === 1);
      const white = gameData.gameUsers.find(u => u.stoneColor === 2);
      return [black?.nickname || '黑棋', white?.nickname || '白棋'];
    }
    if (gameData.gameUsers.length >= 1) {
      return [gameData.gameUsers[0]?.nickname || '黑棋', '白棋'];
    }
    return ['黑棋', '白棋'];
  }

  private extractHandicapFromGameData(gameData: LiveGameData, moves: Move[]): { count: number; stones: Array<{ x: number; y: number; color: 'B' }> } {
    const handicapCount = gameData.gameRule?.handicap ?? 0;
    if (handicapCount === 0) return { count: 0, stones: [] };

    // 优先从 stoneMoves 中提取（flag=3=E_HANDICAP）
    // 野狐解码器在 handicap>0 且 stoneMoves 为空时，已自动补充标准让子位置
    const stones: Array<{ x: number; y: number; color: 'B' }> = [];
    for (const sm of gameData.stoneMoves) {
      if (sm.color === 1 && (sm.flag === 3 || stones.length < handicapCount)) {
        // flag=3 明确是让子棋子，或者未到 handicap 数量时也加入
        stones.push({ x: sm.x, y: sm.y, color: 'B' });
      }
      if (stones.length >= handicapCount) break;
    }

    // 如果 stoneMoves 没有提供足够让子位置，从 moves 开头补充
    if (stones.length < handicapCount) {
      const existingSet = new Set(stones.map(s => `${s.x},${s.y}`));
      for (const move of moves) {
        if (move.color === 1 && !existingSet.has(`${move.x},${move.y}`) && stones.length < handicapCount) {
          stones.push({ x: move.x, y: move.y, color: 'B' });
        }
        if (stones.length >= handicapCount) break;
      }
    }

    return { count: handicapCount, stones };
  }

  private extractKomiFromGameData(gameData: LiveGameData, handicap: number): number {
    if (gameData.gameRule) {
      // 使用 domain 层的 komiFromProto 转换 Protobuf 中的贴目值
      const komi = komiFromProto(gameData.gameRule.komi);
      if (komi > 0) return komi;
      // komi=0 在让子棋中是合法的（野狐让子棋贴目为 0）
      if (gameData.gameRule.handicap > 0) return 0;
    }

    // 根据让子数计算（兜底）
    if (handicap >= 2) {
      return 7.5 - handicap;
    }

    return 7.5;
  }

  private extractResultFromGameData(gameData: LiveGameData): string | null {
    if (!gameData.gameResult) return null;

    const { winner, points, reason } = gameData.gameResult;
    if (winner === 0) return '0';

    const winnerStr = winner === 1 ? 'B' : 'W';
    if (reason === 3) return `${winnerStr}+R`;  // 中盘胜
    if (reason === 2) return `${winnerStr}+T`;  // 超时胜
    if (reason === 4) return `${winnerStr}+R`;  // 认输
    if (points > 0) return `${winnerStr}+${points}`;
    return `${winnerStr}+`;
  }
}
