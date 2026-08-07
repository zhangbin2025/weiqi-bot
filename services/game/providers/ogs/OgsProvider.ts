/**
 * @fileoverview OGS (Online-Go.com) 提供者实现
 */

import { BaseProvider } from "../base/BaseProvider";
import type { FetchResult, GameMetadata, PerformanceTiming } from "../base/types";
import type { IOgsProvider } from "./IOgsProvider";
import type { OgsGameResponse } from "./types";
import { OgsSgfGenerator } from "./OgsSgfGenerator";

/**
 * OGS API 基础 URL
 */
const OGS_API_URL = "https://online-go.com/api/v1";

/**
 * OGS 提供者
 *
 * 支持从 OGS (Online-Go.com) 下载棋谱。
 * 纯 REST API 实现，无需 Playwright。
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
      // 2. 调用 API
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

      // 3. 解析数据并生成 SGF
      const metadata = this.parseMetadata(response.data, gameId);
      const sgfStart = this.now();
      const sgfContent = this.sgfGenerator.generate(response.data, metadata);
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
      // 将 OGS 原始 outcome 翻译为 SGF 标准格式
      // OGS 返回: "Resignation", "Timeout", "Score", "6.5" 等
      // SGF 标准: "B+R", "W+R", "B+T", "W+T", "W+6.5" 等
      const outcome = data.outcome;
      const blackLost = !!data.black_lost;
      const whiteLost = !!data.white_lost;
      const winner = blackLost ? "W" : "B";

      if (outcome === "Resignation") {
        result = winner + "+R";
      } else if (outcome === "Timeout") {
        result = winner + "+T";
      } else {
        // 尝试从 outcome 中提取目数
        // OGS 格式: "17.5 points", "6.5", "Score" 等
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

    // 直播状态：棋局未结束即为直播中
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
   * 参考: https://ogs.readme.io/docs/ranking-system
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
}
