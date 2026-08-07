/**
 * @fileoverview 新博对弈提供者实现
 *
 * 使用 Sniffer 监听 WebSocket 数据提取棋谱。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IXinboduiyiProvider } from './IXinboduiyiProvider';
import type { XinboduiyiGameData } from './types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';
import type { WsMessageData } from '../../../../infrastructure/network/interfaces/SnifferTypes';
import { XinboduiyiParser } from './XinboduiyiParser';

/**
 * 新博对弈提供者
 */
export class XinboduiyiProvider extends BaseProvider implements IXinboduiyiProvider {
  readonly name = 'xinboduiyi';
  readonly displayName = '新博对弈';
  readonly urlPatterns = [
    /xinboduiyi\.com.*?[?&]gameid=(\d+)/,
    /xinboduiyi\.com\/play-room.*?[?&]id=(\d+)/,
    /xinboduiyi\.com.*?[?&]gamekey=([^&]+)/,
  ];

  private readonly parser = new XinboduiyiParser();

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetchByGameId(gameId: string): Promise<void> {
    const url = `https://www.xinboduiyi.com/play-room?id=${gameId}`;
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
      return this.createErrorResult(url, '无法从 URL 提取对局 ID', timing);
    }

    try {
      // 启动 Sniffer
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 15000,
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
            console.error('[新博] 关闭会话错误:', e);
          }
        }
      };

      // 收集 WebSocket 消息
      const wsMessages: any[] = [];
      
      session.onMessage((msg) => {
        if (msg.type === 'ws_receive' || msg.type === 'ws_send') {
          try {
            const wsMsg = msg as WsMessageData;
            if (!wsMsg.isBinary && wsMsg.data) {
              const data = JSON.parse(wsMsg.data);
              // 检查是否是游戏数据（cmd: 2 或 6）
              if (String(data.cmd) === '2' || String(data.cmd) === '6') {
                wsMessages.push(data.data);
                // cmd: 6 表示游戏数据已完整，停止抓包
                if (String(data.cmd) === '6') {
                  setTimeout(() => ensureSessionClosed(), 500);
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      });

      // 等待数据
      const result = await session.wait(15000);
      timing.apiRequest = this.now() - fetchStart;

      if (!result.success) {
        console.error('[新博] Sniffer 失败:', result.error);
        return this.createErrorResult(url, result.error || 'Sniffer 抓取数据失败', timing);
      }

      // 从 session 获取所有消息（包括 onMessage 注册前的消息）
      const allMessages = session.getMessages();

      for (const msg of allMessages) {
        if (msg.type === 'ws_receive' || msg.type === 'ws_send') {
          try {
            const wsMsg = msg as WsMessageData;
            if (!wsMsg.isBinary && wsMsg.data) {
              const data = JSON.parse(wsMsg.data);
              // 检查是否是游戏数据（cmd: 2 或 6）
              if (String(data.cmd) === '2' || String(data.cmd) === '6') {
                wsMessages.push(data.data);
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }

      // 检查是否获取到数据
      if (wsMessages.length === 0) {
        console.error('[新博] 未捕获到游戏数据');
        return this.createErrorResult(url, '未捕获到游戏数据', timing);
      }

      // 使用第一条消息
      const gameData: XinboduiyiGameData = wsMessages[0];

      // 解析数据
      const metadata = this.parser.buildMetadata(gameData, gameId);
      const moves = this.parser.parseMoves(gameData);
      const sgfStart = this.now();
      const sgfContent = this.parser.generateSgf(metadata, moves);
      timing.sgfGeneration = this.now() - sgfStart;

      timing.total = this.now() - startTime;

      // 确保关闭 session
      await ensureSessionClosed();

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