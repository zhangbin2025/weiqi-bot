/**
 * @fileoverview 弈客少儿提供者实现
 *
 * 使用 Sniffer 拦截 API 响应提取棋谱数据。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IYikeShaoerProvider } from './IYikeShaoerProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { HttpResponseData } from '../../../../infrastructure/network/interfaces/SnifferTypes';

/**
 * 弈客少儿提供者
 *
 * URL 格式：
 * - https://shaoer.yikeweiqi.com/statichtml/game_analysis_mobile.html?p={ENCODED_PARAMS}
 */
export class YikeShaoerProvider extends BaseProvider implements IYikeShaoerProvider {
  readonly name = 'yike-shaoer';
  readonly displayName = '弈客少儿';
  readonly urlPatterns = [
    /shaoer\.yikeweiqi\.com.*p=([A-Za-z0-9+/=]+)/,
  ];

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetchByGameId(gameId: string): Promise<string> {
    // 弈客少儿需要通过 URL 参数解码获取 gameId
    // 此方法保留接口兼容性
    throw new Error('请使用 fetch(url) 方法');
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

    // 2. 提取编码参数
    const encodedParam = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!encodedParam) {
      return this.createErrorResult(url, '无法从 URL 提取参数', timing);
    }

    // 3. 解码参数获取 userSgfDepotId (需要两次 base64 解码)
    let sgfId: string;
    try {
      sgfId = this.decodeSgfId(encodedParam);
    } catch (error) {
      return this.createErrorResult(
        url,
        `参数解码失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }

    try {
      // 启动 Sniffer
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 10000,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        viewport: { width: 375, height: 812 },
        httpPattern: 'yikemo/anon/ayalyse/init', // 过滤 API
      });

      // 收集数据
      const sgfCandidates: string[] = [];
      const gameInfo: Record<string, string | number> = {};

      session.onMessage((msg) => {
        if (msg.type === 'http_response') {
          try {
            const httpMsg = msg as HttpResponseData;
            if (httpMsg.url.includes('yikemo/anon/ayalyse/init') && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (data?.code === '200' && data?.aiResultList?.[0]) {
                const gameData = data.aiResultList[0];
                const sgfContent = gameData.sgfContent;
                if (sgfContent) {
                  sgfCandidates.push(sgfContent);
                }
                gameInfo['blackName'] = gameData.blackBy || '';
                gameInfo['whiteName'] = gameData.whiteBy || '';
                gameInfo['blackRank'] = gameData.blackDan || '';
                gameInfo['whiteRank'] = gameData.whiteDan || '';
                gameInfo['result'] = gameData.sgfResult || '';
                gameInfo['date'] = gameData.chessTime || '';
                gameInfo['movesCount'] = gameData.handsCount || 0;
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
            if (httpMsg.url.includes('yikemo/anon/ayalyse/init') && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              if (data?.code === '200' && data?.aiResultList?.[0]) {
                const gameData = data.aiResultList[0];
                const sgfContent = gameData.sgfContent;
                if (sgfContent && !sgfCandidates.includes(sgfContent)) {
                  sgfCandidates.push(sgfContent);
                }
                // 只在未设置时才更新（优先使用第一个响应）
                if (!gameInfo['blackName']) {
                  gameInfo['blackName'] = gameData.blackBy || '';
                  gameInfo['whiteName'] = gameData.whiteBy || '';
                  gameInfo['blackRank'] = gameData.blackDan || '';
                  gameInfo['whiteRank'] = gameData.whiteDan || '';
                  gameInfo['result'] = gameData.sgfResult || '';
                  gameInfo['date'] = gameData.chessTime || '';
                  gameInfo['movesCount'] = gameData.handsCount || 0;
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
      const sgfContent = sgfCandidates[0]!;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId: sgfId,
          blackName: String(gameInfo['blackName'] || '黑棋'),
          whiteName: String(gameInfo['whiteName'] || '白棋'),
          blackRank: String(gameInfo['blackRank'] || ''),
          whiteRank: String(gameInfo['whiteRank'] || ''),
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

  /**
   * 解码 SGF ID（两次 base64 解码）
   */
  private decodeSgfId(encoded: string): string {
    // 第一次解码
    const decoded1 = this.base64Decode(encoded);
    // 第二次解码
    const decoded2 = this.base64Decode(decoded1);
    // 解析 JSON
    const data = JSON.parse(decoded2) as { userSgfDepotId?: string | number };
    const sgfId = data?.userSgfDepotId;
    if (!sgfId) {
      throw new Error('未找到 userSgfDepotId');
    }
    return String(sgfId);
  }

  /**
   * 安全的 base64 解码
   */
  private base64Decode(str: string): string {
    // 添加 padding
    let s = str;
    const padding = 4 - (s.length % 4);
    if (padding !== 4) {
      s += '='.repeat(padding);
    }
    return Buffer.from(s, 'base64').toString('utf-8');
  }
}