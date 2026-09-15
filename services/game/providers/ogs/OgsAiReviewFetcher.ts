/**
 * @fileoverview OGS AI Review 数据获取器
 *
 * 通过 WebSocket 连接 wss://ai.online-go.com/ 获取 AI 复盘数据。
 * 匿名用户即可访问，无需登录认证。
 *
 * 数据获取流程：
 * 1. REST API GET /api/v1/games/{id}/ai_reviews 获取 AI review 列表
 * 2. 如有 AI review，连接 wss://ai.online-go.com/
 * 3. emit('ai-review-connect', {uuid, game_id, ai_review_id})
 * 4. 监听 uuid 通道接收数据（metadata + move-N + variation-N）
 * 5. 超时后断开，返回整合后的数据
 */

import type { OgsAiReviewMeta, OgsAiReviewData, OgsAiReviewMetadata, OgsAiReviewMove, OgsAiReviewSummary } from "./types";

/** OGS REST API 基础 URL */
const OGS_API_URL = "https://online-go.com/api/v1";

/** AI Review WebSocket URL */
const OGS_AI_WS_URL = "wss://ai.online-go.com/";

/** WebSocket 数据接收超时（毫秒） */
const WS_TIMEOUT_MS = 20000;

/** WebSocket 数据接收后的额外等待时间（毫秒） */
const WS_EXTRA_WAIT_MS = 8000;

/**
 * OGS AI Review 数据获取器
 */
export class OgsAiReviewFetcher {
  /**
   * 获取指定对局的 AI Review 数据
   *
   * @param gameId - OGS 对局 ID
   * @param network - NetworkManager 实例（用于 REST API 请求）
   * @returns AI Review 汇总数据，如无 AI review 则返回 null
   */
  async fetch(
    gameId: number,
    requestFn: (url: string) => Promise<any>
  ): Promise<OgsAiReviewSummary | null> {
    // 1. 通过 REST API 获取 AI review 列表
    const reviews = await this.getAiReviewList(gameId, requestFn);
    if (!reviews || reviews.length === 0) {
      return null;
    }

    const review = reviews[0]!;
    console.log(`[OgsAiReview] Found AI review: id=${review.id}, uuid=${review.uuid}, engine=${review.engine}`);

    // 2. 通过 WebSocket 获取详细数据
    const aiData = await this.fetchViaWebSocket(review, gameId);
    if (!aiData) {
      return null;
    }

    // 3. 整合数据
    return this.summarize(aiData);
  }

  /**
   * REST API 获取 AI review 列表
   */
  private async getAiReviewList(
    gameId: number,
    requestFn: (url: string) => Promise<any>
  ): Promise<OgsAiReviewMeta[] | null> {
    try {
      const url = `${OGS_API_URL}/games/${gameId}/ai_reviews`;
      const data = await requestFn(url);
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
      return null;
    } catch (e) {
      console.warn(`[OgsAiReview] Failed to get AI review list:`, e);
      return null;
    }
  }

  /**
   * 通过 WebSocket 获取 AI review 详细数据
   */
  private async fetchViaWebSocket(
    review: OgsAiReviewMeta,
    gameId: number
  ): Promise<OgsAiReviewData | null> {
    const { io } = await import("socket.io-client");

    return new Promise<OgsAiReviewData | null>((resolve) => {
      const socket = io(OGS_AI_WS_URL, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        timeout: 10000,
      });

      let settled = false;
      const accumulated: OgsAiReviewData = {};

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.disconnect();
          const hasData = Object.keys(accumulated).length > 0;
          resolve(hasData ? accumulated : null);
        }
      }, WS_TIMEOUT_MS);

      socket.on("connect", () => {
        // 发送 ai-review-connect 事件（注意是连字符，不是斜杠）
        socket.emit("ai-review-connect", {
          uuid: review.uuid,
          game_id: gameId,
          ai_review_id: review.id,
        });

        // 监听 uuid 通道接收数据
        socket.on(review.uuid, (data: Record<string, unknown>) => {
          // 合并数据
          if (data['metadata']) {
            accumulated['metadata'] = data['metadata'] as OgsAiReviewMetadata;
          }
          // 合并 move-N 和 variation-N 数据
          for (const key in data) {
            if (key !== 'metadata') {
              accumulated[key] = data[key];
            }
          }

          // 延迟一段时间等待更多数据到达，然后断开
          setTimeout(() => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              socket.disconnect();
              resolve(accumulated);
            }
          }, WS_EXTRA_WAIT_MS);
        });
      });

      socket.on("connect_error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });

      socket.on("disconnect", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          const hasData = Object.keys(accumulated).length > 0;
          resolve(hasData ? accumulated : null);
        }
      });
    });
  }

  /**
   * 将 WebSocket 数据整合为 OgsAiReviewSummary
   */
  private summarize(data: OgsAiReviewData): OgsAiReviewSummary | null {
    const meta = data.metadata;
    if (!meta) {
      return null;
    }

    const winRates: number[] = meta.win_rates || [];
    const scores: number[] = meta.scores || [];

    // 收集 move-N 详细数据
    // OGS 的 move-N 中 N 是 1-based（第几手），转为 0-based 索引存储
    const moveDetails = new Map<number, OgsAiReviewMove>();
    for (const key in data) {
      if (key.startsWith("move-")) {
        const n = parseInt(key.split("-")[1]!);
        const moveData = data[key] as OgsAiReviewMove;
        if (moveData && typeof moveData === "object") {
          moveDetails.set(n - 1, moveData); // 1-based → 0-based
        }
      }
    }

    return {
      engine: meta.engine || "unknown",
      network: meta.network || "unknown",
      finalWinRate: meta.win_rate ?? 0,
      winRates,
      scores,
      moveDetails,
    };
  }
}
