/**
 * @fileoverview 1919围棋提供者实现
 *
 * 使用 HTTP Hook 拦截 /api/engine/games/shared/ API 响应获取棋谱数据。
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IWeiqi1919Provider } from './IWeiqi1919Provider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

/**
 * 1919围棋提供者
 */
export class Weiqi1919Provider extends BaseProvider implements IWeiqi1919Provider {
  readonly name = 'weiqi1919';
  readonly displayName = '1919围棋';
  readonly urlPatterns = [
    /19x19\.com.*sgf\/(\d+)/,
    /golaxy.*sgf\/(\d+)/,
  ];

  constructor(
    network: NetworkManager,
    private readonly sniffer: ISnifferProvider
  ) {
    super(network);
  }

  async fetchBySgfId(sgfId: string): Promise<void> {
    const url = `https://m.19x19.com/app/dark/zh/sgf/${sgfId}`;
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
      return this.createErrorResult(url, '无法从 URL 提取棋谱 ID', timing);
    }

    try {
      // 启动 Sniffer
      const fetchStart = this.now();
      const session = await this.sniffer.start(url, {
        timeout: 12000, // 等待 12 秒
      });

      // 等待页面加载并发起 HTTP 请求
      await new Promise(resolve => setTimeout(resolve, 8000));

      // 从 HTTP 响应中获取数据
      let sgfContent: string | null = null;
      const messages = session.getMessages();
      
      for (const msg of messages) {
        if (msg.type === 'http_response') {
          try {
            const httpMsg = msg as any;
            const responseUrl = httpMsg.url || '';
            const body = httpMsg.body || '';
            
            // 检查是否是棋谱共享 API
            if (responseUrl.includes('/api/engine/games/shared/') && body) {
              try {
                const data = JSON.parse(body);
                
                // 检查是否成功
                if (data.code === '0' && data.data && data.data.sgf) {
                  sgfContent = data.data.sgf;
                  break;
                }
              } catch (e) {
                // JSON 解析失败，继续检查下一个响应
              }
            }
          } catch (e) {
            // 处理 HTTP 响应失败，继续检查下一个响应
          }
        }
      }

      await session.stop();
      timing.apiRequest = this.now() - fetchStart;

      if (!sgfContent) {
        return this.createErrorResult(url, '未找到棋谱数据', timing);
      }

      // 直接使用从 API 获取的 SGF 内容
      // SGF 格式已经包含了所有信息，不需要额外解析
      const sgfStart = this.now();
      // sgfContent 已经是完整的 SGF 字符串，不需要生成
      timing.sgfGeneration = this.now() - sgfStart;

      timing.total = this.now() - startTime;

      // 从 SGF 中提取基本信息（可选）
      // 由于 SGF 已经包含了所有信息，这里简单解析一下
      const pbMatch = sgfContent.match(/PB\[([^\]]+)\]/);
      const pwMatch = sgfContent.match(/PW\[([^\]]+)\]/);
      const brMatch = sgfContent.match(/BR\[([^\]]+)\]/);
      const wrMatch = sgfContent.match(/WR\[([^\]]+)\]/);
      const reMatch = sgfContent.match(/RE\[([^\]]+)\]/);
      const szMatch = sgfContent.match(/SZ\[([^\]]+)\]/);
      const kmMatch = sgfContent.match(/KM\[([^\]]+)\]/);
      
      // 统计手数（通过分号数量）
      const movesCount = (sgfContent.match(/;/g) || []).length - 1; // 减去开头的 ;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId,
          blackName: pbMatch ? pbMatch[1]! : '黑棋',
          whiteName: pwMatch ? pwMatch[1]! : '白棋',
          blackRank: brMatch ? brMatch[1]! : '',
          whiteRank: wrMatch ? wrMatch[1]! : '',
          width: szMatch ? parseInt(szMatch[1]!, 10) : 19,
          height: szMatch ? parseInt(szMatch[1]!, 10) : 19,
          komi: kmMatch ? parseFloat(kmMatch[1]!) : 7.5,
          handicap: 0,
          rules: 'chinese',
          date: '',
          result: reMatch ? reMatch[1]! : '',
          movesCount,
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