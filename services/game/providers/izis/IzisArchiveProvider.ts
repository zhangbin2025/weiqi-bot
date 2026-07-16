/**
 * @fileoverview izis 非直播棋谱提供者实现
 *
 * 直接通过 HTTP 请求获取 HTML 页面，从中提取 SGF 数据。
 * 适用于分享链接如：http://app.izis.cn:8080/GoWebService/2/game_875347.html
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IIzisProvider } from './IIzisProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import { IzisParser } from './IzisParser';

/**
 * izis 非直播棋谱提供者
 *
 * 处理分享页面链接，直接抓取 HTML 中的 SGF 数据。
 * 与 IzisProvider（直播模式）区分：
 * - IzisProvider：使用 Sniffer 拦截 API 响应（直播模式）
 * - IzisArchiveProvider：直接 HTTP 请求 HTML 提取 SGF（非直播模式）
 */
export class IzisArchiveProvider extends BaseProvider implements IIzisProvider {
  readonly name = 'izis-archive';
  readonly displayName = '隐智智能棋盘(分享)';
  readonly urlPatterns = [
    /app\.izis\.cn.*\/game_(\d+)\.html/,  // 匹配 /game_875347.html 格式
  ];

  private readonly parser = new IzisParser();

  constructor(network: NetworkManager) {
    super(network);
  }

  async fetchByGameId(gameId: string): Promise<void> {
    const url = `http://app.izis.cn:8080/GoWebService/2/game_${gameId}.html`;
    await this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, '无法从 URL 提取游戏 ID', timing);
    }

    try {
      // 直接请求 HTML 页面
      const fetchStart = this.now();
      const response = await this.network.request<string>({
        url,
        method: 'GET',
        responseType: 'text',
      });
      timing.apiRequest = this.now() - fetchStart;

      const html = response.data;
      if (!html) {
        return this.createErrorResult(url, '请求返回空内容', timing);
      }

      // 从 HTML 中提取 SGF
      const sgfStart = this.now();
      const sgfContent = this.parser.extractSgfFromHtml(html);

      if (!sgfContent) {
        return this.createErrorResult(url, '未能在页面中找到 SGF 数据', timing);
      }
      timing.sgfGeneration = this.now() - sgfStart;

      // 解析 SGF 提取元数据
      const metadata = this.parser.parseSgfMetadata(sgfContent, gameId);

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
