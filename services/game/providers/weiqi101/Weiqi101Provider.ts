/**
 * @fileoverview 101围棋网提供者实现
 */

import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, PerformanceTiming } from '../base/types';
import type { IWeiqi101Provider } from './IWeiqi101Provider';
import type { Weiqi101PlayInfo } from './types';
import { Weiqi101WsHelper } from './Weiqi101WsHelper';
import { Weiqi101SgfGenerator } from './Weiqi101SgfGenerator';
import { Weiqi101Parser } from './Weiqi101Parser';

/** 101围棋网基础 URL */
const WEIQI101_BASE_URL = 'https://www.101weiqi.com';

/**
 * 101围棋网提供者
 */
export class Weiqi101Provider extends BaseProvider implements IWeiqi101Provider {
  readonly name = 'weiqi101';
  readonly displayName = '101围棋网';
  readonly urlPatterns = [
    // 对局页面
    /101weiqi\.com\/play\/p\/(\d+)/,
    /101weiqi\.com\/play\/(\d+)/,
    /101weiqi\.cn\/play\/p\/(\d+)/,
    /101weiqi\.cn\/play\/(\d+)/,
    // 题目页面
    /101weiqi\.com\/qday\/(\d+)\/(\d+)\/(\d+)\/(\d+)/, // 每日八题
    /101weiqi\.com\/q\/(\d+)/, // 单题
    /101weiqi\.cn\/qday\/(\d+)\/(\d+)\/(\d+)\/(\d+)/,
    /101weiqi\.cn\/q\/(\d+)/,
  ];

  private readonly wsHelper = new Weiqi101WsHelper();
  private readonly sgfGenerator = new Weiqi101SgfGenerator();
  private readonly parser = new Weiqi101Parser();

  async fetchById(playId: string): Promise<FetchResult> {
    const url = 'https://www.101weiqi.com/play/p/' + playId + '/';
    return this.fetch(url);
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 判断URL类型
    const playId = this.extractPlayId(url);
    const questionId = this.extractQuestionId(url);

    if (playId) {
      // 对局页面
      return this.fetchPlay(url, playId, timing, startTime);
    } else if (questionId) {
      // 题目页面
      return this.fetchQuestion(url, timing, startTime);
    }

    return this.createErrorResult(url, '不支持的URL格式', timing);
  }

  /**
   * 抓取对局页面
   */
  private async fetchPlay(
    url: string,
    playId: string,
    timing: PerformanceTiming,
    startTime: number
  ): Promise<FetchResult> {
    try {
      const pageStart = this.now();
      const pageUrl = WEIQI101_BASE_URL + '/play/p/' + playId + '/';

      const response = await this.network.request<string>({
        url: pageUrl,
        method: 'GET',
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const html = response.data;
      const playInfo = this.parser.extractPlayInfo(html);

      if (!playInfo) {
        return this.createErrorResult(url, '无法从页面提取对局数据', timing);
      }

      timing.apiRequest = this.now() - pageStart;

      // 尝试 WebSocket 获取完整数据
      const result = await this.handleWebSocketFallback(playInfo, playId, url, timing);
      timing.total = this.now() - startTime;
      return result;
    } catch (error) {
      return this.createErrorResult(
        url,
        '下载失败: ' + (error instanceof Error ? error.message : String(error)),
        timing
      );
    }
  }

  /**
   * 抓取题目页面
   */
  private async fetchQuestion(
    url: string,
    timing: PerformanceTiming,
    startTime: number
  ): Promise<FetchResult> {
    const fetchStart = this.now();

    try {
      const response = await this.network.request<string>({
        url,
        method: 'GET',
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      timing.apiRequest = this.now() - fetchStart;
      const html = response.data;
      const questionData = this.parser.extractQuestionData(html);

      if (!questionData) {
        return this.createErrorResult(url, '无法从页面提取题目数据', timing);
      }

      // 生成SGF
      const sgfStart = this.now();
      const sgfContent = this.sgfGenerator.generateQuestion(questionData);
      timing.sgfGeneration = this.now() - sgfStart;

      // 计算手数：主分支（第一个答案）的手数
      const totalMoves = questionData.answers.length > 0 
        ? questionData.answers[0]?.pts.length || 0 
        : 0;

      timing.total = this.now() - startTime;

      return {
        success: true,
        source: this.name,
        url,
        sgfContent,
        metadata: {
          source: this.name,
          gameId: String(questionData.qid),
          blackName: questionData.name,
          whiteName: questionData.levelname + ' ' + questionData.qtypename,
          blackRank: questionData.levelname,
          whiteRank: '',
          width: questionData.lu,
          height: questionData.lu,
          komi: questionData.daotiemu || 0,
          handicap: questionData.rangzi || 0,
          rules: 'chinese',
          date: '',
          result: '',
          movesCount: totalMoves,
        },
      };
    } catch (error) {
      return this.createErrorResult(
        url,
        '题目下载失败: ' + (error instanceof Error ? error.message : String(error)),
        timing
      );
    }
  }

  /**
   * 提取对局ID
   */
  private extractPlayId(url: string): string | null {
    const patterns = [
      /101weiqi\.com\/play\/p\/(\d+)/,
      /101weiqi\.com\/play\/(\d+)/,
      /101weiqi\.cn\/play\/p\/(\d+)/,
      /101weiqi\.cn\/play\/(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * 提取题目ID（返回完整URL，因为每日八题需要完整路径）
   */
  private extractQuestionId(url: string): string | null {
    const patterns = [
      /101weiqi\.com\/qday\/\d+\/\d+\/\d+\/\d+/,
      /101weiqi\.com\/q\/\d+/,
      /101weiqi\.cn\/qday\/\d+\/\d+\/\d+\/\d+/,
      /101weiqi\.cn\/q\/\d+/,
    ];

    for (const pattern of patterns) {
      if (pattern.test(url)) {
        return url; // 返回完整URL作为ID
      }
    }

    return null;
  }

  /**
   * 尝试 WebSocket，失败则回退到页面数据
   */
  private async handleWebSocketFallback(
    playInfo: Weiqi101PlayInfo,
    playId: string,
    url: string,
    timing: PerformanceTiming
  ): Promise<FetchResult> {
    try {
      const wsStart = this.now();
      const wsData = await this.wsHelper.fetchViaWebSocket(
        playInfo, 
        { connect: (url: string, opts?: unknown) => this.network.connect(url, opts as any) } as any, 
        { weiqi101BaseUrl: 'https://www.101weiqi.com' }
      );
      timing.sgfGeneration = this.now() - wsStart;

      if (wsData && wsData.pos) {
        const metadata = this.parser.parseMetadata(
          playInfo, playId, this.name, wsData
        );
        const sgfStart = this.now();
        const sgfContent = this.sgfGenerator.generate(wsData.pos, metadata);
        timing.sgfGeneration = (timing.sgfGeneration || 0) + (this.now() - sgfStart);

        return {
          success: true,
          source: this.name,
          url,
          sgfContent,
          metadata,
        };
      }
    } catch {
      // WebSocket 失败，回退到页面数据
    }

    // 回退：使用页面数据
    const metadata = this.parser.parseMetadata(playInfo, playId, this.name);
    const sgfContent = this.sgfGenerator.generate(playInfo.points || [], metadata);

    return {
      success: true,
      source: this.name,
      url,
      sgfContent,
      metadata,
    };
  }
}
