/**
 * @fileoverview OGS 在线棋谱列表 Provider
 *
 * 通过 WebSocket (socket.io) 连接 OGS，获取正在进行的在线对局列表。
 * 不需要登录认证，匿名用户即可查看 live 对局列表。
 */

import type { LatestGameItem } from "../../../../application/fetcher/types";

export interface OgsLiveGame {
  id: number;
  name: string;
  phase: string;
  width: number;
  height: number;
  move_number: number;
  paused: boolean;
  private: boolean;
  ranked: boolean;
  handicap: number;
  komi: number;
  black: {
    username: string;
    id: number;
    rank: number;
    professional: boolean;
  };
  white: {
    username: string;
    id: number;
    rank: number;
    professional: boolean;
  };
  time_per_move?: number;
  clock_expiration?: number;
  rengo?: boolean;
}

interface GamelistQueryResponse {
  list: string;
  by: string;
  size: number;
  where: unknown;
  from: number;
  limit: number;
  results: OgsLiveGame[];
}

/**
 * OGS 在线棋谱列表 Provider
 *
 * 使用 socket.io-client 连接 OGS WebSocket，发送 gamelist/query 获取在线对局列表。
 * 连接后自动断开，不做持续监听。
 */
export class OgsLiveProvider {
  readonly name = "ogs-live";

  /**
   * 获取 OGS 在线棋谱列表
   * @param count - 获取数量
   * @param keyword - 关键词筛选（棋手名）
   * @returns LatestGameItem 列表
   */
  async fetchLiveGames(count: number = 20, keyword?: string): Promise<LatestGameItem[]> {
    const { io } = await import("socket.io-client");

    return new Promise<LatestGameItem[]>((resolve, reject) => {
      const socket = io("wss://online-go.com", {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        timeout: 10000,
      });

      let settled = false;

      const cleanup = () => {
        if (!settled) return;
        try {
          socket.disconnect();
        } catch {
          // ignore
        }
      };

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error("OGS WebSocket 请求超时"));
        }
      }, 15000);

      socket.on("connect", () => {
        // 发送 gamelist/query，带 ack callback
        const query = {
          list: "live",
          sort_by: "rank",
          where: {},
          from: 0,
          limit: Math.min(count, 50),
          channel: "",
        };

        socket.emit("gamelist/query", query, (response: GamelistQueryResponse) => {
          settled = true;
          clearTimeout(timeout);
          cleanup();

          if (!response || !response.results) {
            resolve([]);
            return;
          }

          let games = response.results;

          // 关键词过滤
          if (keyword && keyword.trim()) {
            const kw = keyword.trim().toLowerCase();
            games = games.filter(
              (g) =>
                g.black?.username?.toLowerCase().includes(kw) ||
                g.white?.username?.toLowerCase().includes(kw) ||
                g.name?.toLowerCase().includes(kw),
            );
          }

          const items: LatestGameItem[] = games.map((g) => ({
            source: "ogs-live",
            title: this.formatTitle(g),
            subtitle: `${g.width}×${g.height}`,
            date: new Date().toISOString().slice(0, 10),
            url: `https://online-go.com/game/${g.id}`,
          }));

          resolve(items);
        });
      });

      socket.on("connect_error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          cleanup();
          reject(new Error(`OGS WebSocket 连接失败: ${err.message}`));
        }
      });

      socket.on("disconnect", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("OGS WebSocket 意外断开"));
        }
      });
    });
  }

  private formatTitle(g: OgsLiveGame): string {
    const blackRank = this.formatRank(g.black?.rank);
    const whiteRank = this.formatRank(g.white?.rank);
    const black = g.black?.username || "Unknown";
    const white = g.white?.username || "Unknown";
    const rankStr =
      blackRank || whiteRank
        ? ` [${blackRank || "?"} vs ${whiteRank || "?"}]`
        : "";
    const phaseStr = g.phase === "play" ? "" : ` (${g.phase})`;
    return `${black} vs ${white}${rankStr}${phaseStr}`;
  }

  private formatRank(rank?: number): string {
    if (rank === undefined || rank === null) return "";
    if (rank < 30) return `${Math.floor(30 - rank)}k`;
    return `${Math.floor(rank - 30) + 1}d`;
  }
}
