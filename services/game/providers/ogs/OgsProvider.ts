/**
 * @fileoverview OGS (Online-Go.com) 提供者实现
 *
 * 支持从 OGS 下载棋谱，并自动获取 AI 复盘数据（如有）。
 * AI review 数据通过 WebSocket 连接 wss://ai.online-go.com/ 获取，
 * 包含每手胜率、目差，以及关键手的推荐选点分支。
 */

import { BaseProvider } from "../base/BaseProvider";
import type { FetchResult, GameMetadata, PerformanceTiming } from "../base/types";
import type { IOgsProvider } from "./IOgsProvider";
import type { OgsGameResponse } from "./types";
import { OgsSgfGenerator } from "./OgsSgfGenerator";
import { OgsAiReviewFetcher } from "./OgsAiReviewFetcher";

/**
 * OGS API 基础 URL
 */
const OGS_API_URL = "https://online-go.com/api/v1";

/**
 * OGS 提供者
 *
 * URL 格式：
 * - https://online-go.com/game/{GAME_ID}
 * - https://online-go.com/game/view/{GAME_ID}
 */
export class OgsProvider extends BaseProvider implements IOgsProvider {
  readonly name = "ogs";
  readonly displayName = "OGS (Online-Go)";
  readonly urlPatterns = [
    /online-go\.com\/game\/(\d+)/,
    /online-go\.com\/game\/view\/(\d+)/,
  ];

  private readonly sgfGenerator = new OgsSgfGenerator();
  private readonly aiReviewFetcher = new OgsAiReviewFetcher();

  /**
   * 通过游戏 ID 获取游戏数据
   */
  async fetchById(gameId: string): Promise<FetchResult> {
    const url = `https://online-go.com/game/${gameId}`;
    return this.fetch(url);
  }

  /**
   * 下载棋谱
   */
  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const startTime = this.now();

    // 1. 提取 ID
    const gameId = this.extractId(url);
    timing.extractId = this.now() - startTime;

    if (!gameId) {
      return this.createErrorResult(url, "无法从 URL 提取游戏 ID", timing);
    }

    try {
      // 2. 调用 REST API 获取对局数据
      const apiStart = this.now();
      const apiUrl = `${OGS_API_URL}/games/${gameId}`;

      const response = await this.network.request<OgsGameResponse>({
        url: apiUrl,
        method: "GET",
      });

      timing.apiRequest = this.now() - apiStart;

      if (!response.data) {
        return this.createErrorResult(url, "API 响应为空", timing);
      }

      // 3. 解析元数据
      const metadata = this.parseMetadata(response.data, gameId);

      // 4. 尝试获取 AI Review 数据（仅已结束的对局）
      let aiReview = null;
      if (metadata.isEnded) {
        const aiStart = this.now();
        try {
          aiReview = await this.aiReviewFetcher.fetch(
            parseInt(gameId),
            async (reqUrl: string) => {
              const resp = await this.network.request<any>({
                url: reqUrl,
                method: "GET",
              });
              return resp.data;
            }
          );
        } catch (e) {
          // AI review 获取失败不影响棋谱下载
          console.warn(`[OgsProvider] AI review fetch failed:`, e);
        }
        timing.tokenRequest = this.now() - aiStart;
      }

      // 5. 生成 SGF（含 AI review 数据）
      const sgfStart = this.now();
      const sgfContent = this.sgfGenerator.generateWithAiReview(
        response.data,
        metadata,
        aiReview
      );
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
        `下载失败: ${error instanceof Error ? error.message : String(error)}`,
        timing
      );
    }
  }

  /**
   * 解析元数据
   */
  private parseMetadata(data: OgsGameResponse, gameId: string): GameMetadata {
    const players = data.players || {};
    const black = players.black || {};
    const white = players.white || {};
    const gamedata = data.gamedata || {};

    let result = "";
    if (data.outcome) {
      const outcome = data.outcome;
      const blackLost = !!data.black_lost;
      const whiteLost = !!data.white_lost;
      const winner = blackLost ? "W" : "B";

      if (outcome === "Resignation") {
        result = winner + "+R";
      } else if (outcome === "Timeout") {
        result = winner + "+T";
      } else {
        const pointsMatch = outcome.match(/^([\d.]+)\s*points?$/i)
          || outcome.match(/^([\d.]+)$/);
        if (pointsMatch) {
          result = winner + "+" + pointsMatch[1];
        } else if (outcome === "Score") {
          result = winner + "+S";
        } else {
          result = outcome;
        }
      }
    } else if (data.ended) {
      if (data.black_lost && !data.white_lost) {
        result = "W+R";
      } else if (data.white_lost && !data.black_lost) {
        result = "B+R";
      }
    }

    const isEnded = !!data.ended;
    const isLive = !isEnded;

    return {
      source: this.name,
      gameId,
      blackName: black.username || "Black",
      whiteName: white.username || "White",
      blackRank: this.formatRank(black.ranking),
      whiteRank: this.formatRank(white.ranking),
      width: gamedata.width || 19,
      height: gamedata.height || 19,
      komi: gamedata.komi || 6.5,
      handicap: (gamedata.handicap && gamedata.handicap >= 2) ? gamedata.handicap : 0,
      rules: gamedata.rules || "japanese",
      date: data.started ? data.started.substring(0, 10) : "",
      result,
      movesCount: (gamedata.moves || []).length,
      isLive,
      isEnded,
    };
  }

  /**
   * 格式化段位
   * OGS ranking: 0-30 = 30k-1k, 30+ = 1d, 31+ = 2d, ...
   */
  private formatRank(ranking?: number): string {
    if (ranking === undefined || ranking === null) {
      return "";
    }
    if (ranking < 30) {
      return `${Math.floor(30 - ranking)}k`;
    }
    const dan = Math.floor(ranking - 30) + 1;
    return `${dan}d`;
  }

  /**
   * 获取当前时间戳
   */
  protected override now(): number {
    return Date.now();
  }
}
