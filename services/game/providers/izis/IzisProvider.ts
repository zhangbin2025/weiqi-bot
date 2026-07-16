/**
 * @fileoverview izis围棋提供者实现
 *
 * 使用 Sniffer 拦截 API 响应提取数据。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IIzisProvider } from './IIzisProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { HttpResponseData } from '../../../../infrastructure/network/interfaces/SnifferTypes';
import { IzisParser } from './IzisParser';

/**
 * izis围棋提供者
 */
export class IzisProvider extends BaseProvider implements IIzisProvider {
  readonly name = 'izis';
  readonly displayName = '隐智智能棋盘';
  readonly urlPatterns = [
    /izis\.cn.*gameId=(\d+)/,
    /app\.izis\.cn.*gameId=(\d+)/,
  ];

  private readonly parser = new IzisParser();

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetchByGameId(gameId: string): Promise<void> {
    const url = `http://app.izis.cn/web/#/live_detail?gameId=${gameId}&type=2`;
    await this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    if (!this.sniffer.isAvailable()) {
      return this.createErrorResult(
        url,
        '该平台需要 Sniffer 支持。\n' +
        this.sniffer.getEnvironmentDescription(),
        timing
      );
    }

    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, '无法从 URL 提取游戏 ID', timing);
    }

    try {
      // 启动 Sniffer
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 10000,
        httpPattern: 'getdataserver', // 过滤 API
      });

      // 收集 API 数据
      const apiResponses: { error?: number; data?: Record<string, unknown> }[] = [];

      session.onMessage((msg) => {
        if (msg.type === 'http_response') {
          try {
            const httpMsg = msg as HttpResponseData;
            if (httpMsg.url.includes('getdataserver') && httpMsg.status === 200 && httpMsg.body) {
              apiResponses.push(JSON.parse(httpMsg.body));
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
            if (httpMsg.url.includes('getdataserver') && httpMsg.status === 200 && httpMsg.body) {
              const data = JSON.parse(httpMsg.body);
              // 避免重复添加
              if (!apiResponses.some(r => JSON.stringify(r) === JSON.stringify(data))) {
                apiResponses.push(data);
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }

      // 检查 API 响应
      if (apiResponses.length === 0) {
        return this.createErrorResult(url, '未捕获到 API 响应', timing);
      }

      // 使用第一个成功的响应
      const apiData = apiResponses.find(r => r.error === 0) || apiResponses[0];

      if (!apiData) {
        throw new Error('无法获取棋谱数据');
      }

      // 解析数据
      const data = apiData.data || {};
      const metadata = this.parser.buildMetadata(data, gameId);
      const moves = this.parser.parseMoves(
        (data['f_allstep'] as string) || '', metadata.width
      );

      const sgfStart = this.now();
      const sgfContent = this.parser.generateSgf(metadata, moves);
      timing.sgfGeneration = this.now() - sgfStart;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata,
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