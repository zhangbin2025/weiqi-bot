/**
 * @fileoverview 弈客围棋提供者实现
 *
 * 使用 Sniffer 拦截 API 响应提取棋谱数据。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { IYikeProvider } from './IYikeProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { HttpResponseData } from '../../../../infrastructure/network/interfaces/SnifferTypes';

/**
 * 弈客围棋提供者
 *
 * URL 格式：
 * - https://home.yikeweiqi.com/mobile.html#/golive/room/{ROOM_ID}
 */
export class YikeProvider extends BaseProvider implements IYikeProvider {
  readonly name = 'yike';
  readonly displayName = '弈客围棋';
  readonly urlPatterns = [
    /yikeweiqi\.com.*room\/(\d+)/,
    /home\.yikeweiqi\.com.*room\/(\d+)/,
  ];

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetchByRoomId(roomId: string): Promise<void> {
    const url = `https://home.yikeweiqi.com/mobile.html#/golive/room/${roomId}`;
    await this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 1. 检查 Sniffer
    if (!this.sniffer.isAvailable()) {
      return this.createErrorResult(
        url,
        '该平台需要 Sniffer 支持。\n' +
        this.sniffer.getEnvironmentDescription(),
        timing
      );
    }

    // 2. 提取 room_id
    const roomId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!roomId) {
      return this.createErrorResult(url, '无法从 URL 提取房间 ID', timing);
    }

    try {
      // 启动 Sniffer
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 10000,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        viewport: { width: 375, height: 812 },
      });

      // 收集数据
      const sgfCandidates: string[] = [];
      const gameInfo: Record<string, string | number> = {};

      session.onMessage((msg) => {
        if (msg.type === 'http_response') {
          try {
            const httpMsg = msg as HttpResponseData;
            const apiUrl = httpMsg.url;

            // 鹰眼分析接口
            if (apiUrl.includes('hawkeye_analyses') && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (data?.result?.[0]) {
                const analysis = data.result[0];
                gameInfo['blackName'] = analysis.black_name || '';
                gameInfo['whiteName'] = analysis.white_name || '';
                gameInfo['movesCount'] = analysis.moves || 0;
              }
            }

            // 鹰眼API - 可能包含SGF
            if (apiUrl.includes('hawkeye.yikeweiqi.com/api/report/live/move') && httpMsg.body) {
              const bodyStr = httpMsg.body;
              if (bodyStr.includes('(;GM')) {
                // 提取SGF
                const start = bodyStr.indexOf('(;GM');
                let end = bodyStr.indexOf('\\"', start);
                if (end === -1) {
                  end = bodyStr.indexOf('"', start);
                }
                if (end > start) {
                  sgfCandidates.push(bodyStr.substring(start, end));
                }
              }
            }

            // golive/dtl 接口
            if (apiUrl.includes('golive/dtl') && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (data?.Result?.live) {
                const live = data.Result.live;
                gameInfo['blackName'] = gameInfo['blackName'] || live.BlackName || '';
                gameInfo['whiteName'] = gameInfo['whiteName'] || live.WhiteName || '';
                gameInfo['result'] = live.GameResult || '';
                gameInfo['date'] = live.GameDate || '';

                const content = live.Content || '';
                if (content.includes('(;GM')) {
                  sgfCandidates.push(content);
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      });

      // 等待数据
      const result = await session.wait(10000);
      timing.apiRequest = this.now() - fetchStart;

      if (!result.success) {
        return this.createErrorResult(url, result.error || 'Sniffer 抓取数据失败', timing);
      }

      // 从 session 获取所有消息（包括 onMessage 注册前的消息）
      const allMessages = session.getMessages();

      for (const msg of allMessages) {
        if (msg.type === 'http_response') {
          try {
            const httpMsg = msg as HttpResponseData;
            const apiUrl = httpMsg.url;

            // 鹰眼分析接口
            if (apiUrl.includes('hawkeye_analyses') && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (data?.result?.[0]) {
                const analysis = data.result[0];
                gameInfo['blackName'] = gameInfo['blackName'] || analysis.black_name || '';
                gameInfo['whiteName'] = gameInfo['whiteName'] || analysis.white_name || '';
                gameInfo['movesCount'] = gameInfo['movesCount'] || analysis.moves || 0;
              }
            }

            // 鹰眼API - 可能包含SGF
            if (apiUrl.includes('hawkeye.yikeweiqi.com/api/report/live/move') && httpMsg.body) {
              const bodyStr = httpMsg.body;
              if (bodyStr.includes('(;GM')) {
                const start = bodyStr.indexOf('(;GM');
                let end = bodyStr.indexOf('\\"', start);
                if (end === -1) {
                  end = bodyStr.indexOf('"', start);
                }
                if (end > start) {
                  const sgf = bodyStr.substring(start, end);
                  // 避免重复添加
                  if (!sgfCandidates.includes(sgf)) {
                    sgfCandidates.push(sgf);
                  }
                }
              }
            }

            // golive/dtl 接口
            if (apiUrl.includes('golive/dtl') && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (data?.Result?.live) {
                const live = data.Result.live;
                gameInfo['blackName'] = gameInfo['blackName'] || live.BlackName || '';
                gameInfo['whiteName'] = gameInfo['whiteName'] || live.WhiteName || '';
                gameInfo['result'] = gameInfo['result'] || live.GameResult || '';
                gameInfo['date'] = gameInfo['date'] || live.GameDate || '';

                const content = live.Content || '';
                if (content.includes('(;GM')) {
                  // 避免重复添加
                  if (!sgfCandidates.includes(content)) {
                    sgfCandidates.push(content);
                  }
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }

      // 检查是否获取到数据
      if (sgfCandidates.length === 0) {
        return this.createErrorResult(url, '未获取到 SGF 数据', timing);
      }

      // 使用第一个 SGF
      const sgfData = sgfCandidates[0]!;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent: sgfData,
        metadata: {
          source: this.name,
          gameId: roomId,
          blackName: String(gameInfo['blackName'] || '黑棋'),
          whiteName: String(gameInfo['whiteName'] || '白棋'),
          blackRank: '',
          whiteRank: '',
          width: 19,
          height: 19,
          komi: 6.5,
          handicap: 0,
          rules: 'chinese',
          date: String(gameInfo['date'] || ''),
          result: String(gameInfo['result'] || ''),
          movesCount: Number(gameInfo['movesCount']) || 0,
        },
        timing,
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        `获取失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }
}