/**
 * @fileoverview 腾讯围棋提供者实现
 *
 * 使用 Sniffer 拦截 jsonp.php HTTP 响应提取 SGF 数据。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { ITxwqProvider } from './ITxwqProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { HttpResponseData } from '../../../../infrastructure/network/interfaces/SnifferTypes';
import { TxwqParser, TxwqApiResponse } from './TxwqParser';
import { HttpSnifferProvider } from '../../../../infrastructure/network/adapters/app/HttpSnifferProvider';

/**
 * 腾讯围棋提供者
 *
 * URL 格式：
 * - https://h5.txwq.qq.com/txwqshare/index.html?chessid={CHESS_ID}
 */
export class TxwqProvider extends BaseProvider implements ITxwqProvider {
  readonly name = 'txwq';
  readonly displayName = '腾讯围棋';
  readonly urlPatterns = [
    /txwq\.qq\.com.*chessid=(\d+)/,
    /h5\.txwq\.qq\.com.*chessid=(\d+)/,
  ];

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetchByChessId(chessId: string): Promise<void> {
    const url = `https://h5.txwq.qq.com/txwqshare/index.html?chessid=${chessId}`;
    await this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 1. 检查 Sniffer 是否可用
    if (!this.sniffer.isAvailable()) {
      return this.createErrorResult(
        url,
        '该平台需要 Sniffer 支持。\n' +
        this.sniffer.getEnvironmentDescription(),
        timing
      );
    }

    // 2. 提取 chessid
    const chessId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!chessId) {
      return this.createErrorResult(url, '无法从 URL 提取 chessid', timing);
    }

    try {
      // 启动 Sniffer，过滤 jsonp.php HTTP 响应
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 15000,
        httpPattern: 'jsonp\\.php',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        viewport: { width: 1280, height: 720 },
      });

      // 确保在任何情况下都关闭 session
      let sessionClosed = false;
      const ensureSessionClosed = async () => {
        if (!sessionClosed) {
          sessionClosed = true;
          try {
            await session.stop();
          } catch (e) {
            console.error('[腾讯围棋] 关闭会话错误:', e);
          }
        }
      };

      // 收集 HTTP 响应
      const httpResponses: HttpResponseData[] = [];

      session.onMessage((msg) => {
        if (msg.type === 'http_response') {
          const httpMsg = msg as HttpResponseData;
          httpResponses.push(httpMsg);
          
          // 检查是否包含 SGF 数据
          if (httpMsg.body && httpMsg.body.includes('"chess"')) {
            setTimeout(() => ensureSessionClosed(), 500);
          }
        }
      });

      // 等待数据
      const result = await session.wait(15000);
      timing.apiRequest = this.now() - fetchStart;

      if (!result.success) {
        console.error('[腾讯围棋] Sniffer 失败:', result.error);
        return this.createErrorResult(url, result.error || 'Sniffer 抓取数据失败', timing);
      }

      // 从 session 获取所有消息（包括 onMessage 注册前的消息）
      const allMessages = session.getMessages();

      for (const msg of allMessages) {
        if (msg.type === 'http_response') {
          const httpMsg = msg as HttpResponseData;
          // 避免重复添加
          if (!httpResponses.some(r => r.url === httpMsg.url && r.timestamp === httpMsg.timestamp)) {
            httpResponses.push(httpMsg);
          }
        }
      }

      // 检查是否获取到数据
      if (httpResponses.length === 0) {
        console.error('[腾讯围棋] 未捕获到 HTTP 响应');
        return this.createErrorResult(url, '未捕获到 HTTP 响应', timing);
      }

      // 使用 HttpSnifferProvider 过滤 HTTP 响应
      const filteredResponses = HttpSnifferProvider.filterByUrl(httpResponses, 'jsonp.php');
      
      if (filteredResponses.length === 0) {
        console.error('[腾讯围棋] 未找到 jsonp.php 响应');
        return this.createErrorResult(url, '未找到 jsonp.php 响应', timing);
      }

      // 从第一个响应中提取数据
      const response = filteredResponses[0]!; // 已经检查过数组不为空
      const jsonResponse = HttpSnifferProvider.extractJson<TxwqApiResponse>(response);

      if (!jsonResponse) {
        console.error('[腾讯围棋] 无法解析 JSON 响应');
        return this.createErrorResult(url, '无法解析 JSON 响应', timing);
      }

      // 提取 SGF 数据
      const sgfContent = TxwqParser.extractSgf(jsonResponse);

      if (!sgfContent) {
        console.error('[腾讯围棋] 响应中未包含 SGF 数据');
        return this.createErrorResult(url, '响应中未包含 SGF 数据', timing);
      }

      // 验证 SGF 格式
      if (!TxwqParser.isValidSgf(sgfContent)) {
        console.error('[腾讯围棋] SGF 格式无效');
        return this.createErrorResult(url, 'SGF 格式无效', timing);
      }

      // 清理 SGF
      const cleanedSgf = TxwqParser.cleanSgf(sgfContent);

      // 构建元数据
      const sgfStart = this.now();
      const metadata = TxwqParser.buildMetadata(cleanedSgf, chessId);
      timing.sgfGeneration = this.now() - sgfStart;

      timing.total = this.now() - startTime;

      // 确保关闭 session
      await ensureSessionClosed();

      return {
        success: true,
        source: this.name,
        url,
        sgfContent: cleanedSgf,
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
