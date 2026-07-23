/**
 * @fileoverview 弈客围棋 online-game 提供者
 * 
 * 支持的 URL 格式：
 * - https://home.yikeweiqi.com/mobile.html#/online-game/{GAME_ID}
 * 
 * 特点：
 * - 使用Sniffer拦截HTTP响应获取棋谱
 * - 支持直播棋谱识别和元数据注入
 * - 使用domain/sgf模块处理SGF
 * - 需要Sniffer支持（App环境、Desktop环境可用，Web环境不支持）
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { HttpResponseData } from '../../../../infrastructure/network/interfaces/SnifferTypes';
import { SGFParser, coordToPos } from '../../../../domain/sgf';
import { SGFWriter } from '../../../../domain/sgf';
import { createMove, createPassMove } from '../../../../domain/move';

/**
 * 弈客围棋 online-game 提供者
 */
export class YikeOnlineGameProvider extends BaseProvider {
  readonly name = 'yike-online';
  readonly displayName = '弈客围棋在线对局';
  readonly urlPatterns = [
    /home\.yikeweiqi\.com.*online-game\/(\d+)/,
  ];

  private readonly parser = new SGFParser();
  private readonly writer = new SGFWriter();

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    console.log('[YikeOnlineGameProvider] 开始抓取:', url);

    // 检查Sniffer可用性
    if (!this.sniffer.isAvailable()) {
      return this.createErrorResult(
        url,
        '该平台需要 Sniffer 支持。\n' +
        this.sniffer.getEnvironmentDescription(),
        timing
      );
    }

    // 提取游戏 ID
    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, '无法从 URL 提取游戏 ID', timing);
    }

    console.log('[YikeOnlineGameProvider] 游戏ID:', gameId);

    try {
      // 启动Sniffer（监听HTTP）
      const fetchStart = this.now();
      console.log('[YikeOnlineGameProvider] 启动Sniffer...');
      
      const session = await this.sniffer.start(url, {
        timeout: 5000, // 5秒超时
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        viewport: { width: 375, height: 812 },
      });

      // 存储游戏数据
      let sgfContent: string | null = null;
      let gameData: any = null;

      // 监听HTTP响应
      session.onMessage((msg) => {
        if (msg.type === 'http_response') {
          const httpMsg = msg as HttpResponseData;
          console.log('[YikeOnlineGameProvider] HTTP响应:', httpMsg.url.substring(0, 100));
          
          // 检查是否是game/info API
          if (httpMsg.url.includes('game-server.yikeweiqi.com/game/info') && httpMsg.body) {
            console.log('[YikeOnlineGameProvider] ✓ 找到game/info API');
            try {
              const data = JSON.parse(httpMsg.body);
              if (data?.data?.sgf) {
                sgfContent = data.data.sgf;
                gameData = data.data;
                console.log('[YikeOnlineGameProvider] ✓ SGF长度:', sgfContent?.length || 0);
              } else {
                console.log('[YikeOnlineGameProvider] API返回错误:', data?.msg);
              }
            } catch (e) {
              console.error('[YikeOnlineGameProvider] 解析HTTP响应失败:', e);
            }
          }
        }
      });

      // 等待数据
      const result = await session.wait(5000);
      timing.apiRequest = this.now() - fetchStart;

      console.log('[YikeOnlineGameProvider] Sniffer结果:', result.success);

      if (!result.success) {
        return this.createErrorResult(url, result.error || 'Sniffer 抓取数据失败', timing);
      }

      // 从session获取所有消息
      if (!sgfContent) {
        const allMessages = session.getMessages();
        for (const msg of allMessages) {
          if (msg.type === 'http_response') {
            const httpMsg = msg as HttpResponseData;
            if (httpMsg.url.includes('game-server.yikeweiqi.com/game/info') && httpMsg.body) {
              try {
                const data = JSON.parse(httpMsg.body);
                if (data?.data?.sgf) {
                  sgfContent = data.data.sgf;
                  gameData = data.data;
                }
              } catch (e) {
                // 忽略
              }
            }
          }
        }
      }

      // 检查是否获取到数据
      if (!sgfContent) {
        return this.createErrorResult(url, '未获取到 SGF 数据', timing);
      }

      // 使用domain模块增强SGF
      const sgfStart = this.now();
      const enhancedSgf = this.enhanceSgf(sgfContent, gameData);
      timing.sgfGeneration = this.now() - sgfStart;

      const blackPlayer = gameData?.players?.blacks?.[0];
      const whitePlayer = gameData?.players?.whites?.[0];
      
      // 判断对局是否结束（有结果字段）
      const isEnded = !!(gameData?.result && gameData.result.length > 0);

      timing.total = this.now() - startTime;

      console.log('[YikeOnlineGameProvider] ✓ 成功获取棋谱，长度:', enhancedSgf.length);
      console.log('[YikeOnlineGameProvider] 对局是否结束:', isEnded);
      console.log('[YikeOnlineGameProvider] 直播棋谱: 是');

      const metadata: GameMetadata = {
        source: this.name,
        gameId,
        blackName: blackPlayer?.name || '黑棋',
        whiteName: whitePlayer?.name || '白棋',
        blackRank: blackPlayer?.grade || '',
        whiteRank: whitePlayer?.grade || '',
        width: gameData?.board_size || 19,
        height: gameData?.board_size || 19,
        komi: gameData?.komi || 7.5,
        handicap: gameData?.handicap || 0,
        rules: gameData?.rule || 'chinese',
        date: gameData?.begin_time?.split(' ')[0] || '',
        result: gameData?.result || '',
        movesCount: gameData?.hands_count || 0,
        isLive: true, // 标记为直播棋谱
        isEnded, // 标记对局是否结束
      };

      return {
        success: true,
        source: this.name,
        url,
        sgfContent: enhancedSgf,
        metadata,
        timing,
      };
    } catch (error) {
      console.error('[YikeOnlineGameProvider] 异常:', error);
      return this.createErrorResult(
        url,
        '获取失败: ' + (error instanceof Error ? error.message : String(error)),
        timing
      );
    }
  }

  /**
   * 使用domain模块增强SGF内容
   * 1. 解析原始SGF
   * 2. 提取着法序列
   * 3. 合并API返回的元数据
   * 4. 使用SGFWriter重新构造
   */
  private enhanceSgf(sgf: string, gameData: any): string {
    if (!gameData) return sgf;

    try {
      // 解析原始SGF
      const parseResult = this.parser.parse(sgf);
      
      if (parseResult.errors.length > 0) {
        console.warn('[YikeOnlineGameProvider] SGF解析警告:', parseResult.errors);
      }

      // 从API数据提取元数据
      const blackPlayer = gameData.players?.blacks?.[0];
      const whitePlayer = gameData.players?.whites?.[0];

      // 构建SGFWriter需要的info对象
      const info = {
        size: gameData.board_size || 19,
        blackName: blackPlayer?.name || parseResult.gameInfo.black || '黑棋',
        whiteName: whitePlayer?.name || parseResult.gameInfo.white || '白棋',
        blackRank: blackPlayer?.grade,
        whiteRank: whitePlayer?.grade,
        komi: parseFloat(gameData.komi || parseResult.gameInfo.komi || '7.5'),
        result: gameData.result || parseResult.gameInfo.result,
        date: gameData.begin_time?.split(' ')[0] || parseResult.gameInfo.date,
        handicap: gameData.handicap || parseResult.gameInfo.handicap,
        handicapStones: parseResult.gameInfo.handicapStones,
      };

      // 转换moves格式为MoveOrPass
      const moves = this.convertMoves(parseResult.moves);

      // 使用SGFWriter重新构造SGF
      const enhancedSgf = this.writer.write(moves, info);

      return enhancedSgf;
    } catch (error) {
      console.error('[YikeOnlineGameProvider] SGF处理失败，返回原始SGF:', error);
      return sgf;
    }
  }

  /**
   * 将解析结果的moves转换为MoveOrPass格式
   */
  private convertMoves(parsedMoves: Array<{ color: 'B' | 'W'; coord: string }>): import('../../../../domain/move').MoveOrPass[] {
    const { coordToPos } = require('../../../../domain/sgf');
    
    return parsedMoves.map((move, index) => {
      const color = move.color === 'B' ? 'black' as const : 'white' as const;
      const number = index + 1;
      
      // 处理停一手（tt）
      if (move.coord === 'tt') {
        return createPassMove(color, number);
      }
      
      // 解析坐标
      const pos = coordToPos(move.coord);
      if (!pos) {
        console.warn('[YikeOnlineGameProvider] 无效坐标:', move.coord);
        return createPassMove(color, number);
      }
      
      return createMove(pos.x, pos.y, color, number);
    });
  }
}
