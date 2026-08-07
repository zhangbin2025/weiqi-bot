/**
 * @fileoverview 野狐围棋棋谱下载功能
 */

import type { NetworkManager } from "../../../../infrastructure/network/core/NetworkManager";
import type { FoxwqGame, FoxwqChessListResponse, FoxwqSgfResponse } from "./types";

/** 野狐棋谱 API URL */
const FOXWQ_API_BASE = "https://h5.foxwq.com/yehuDiamond/chessbook_local";

/**
 * 野狐围棋棋谱下载提供者
 */
export class FoxwqChessProvider {
  constructor(private readonly network: NetworkManager) {}

  /**
   * 获取用户棋谱列表
   */
  async fetchChessList(uid: string, lastcode = "0"): Promise<FoxwqGame[]> {
    const url = `${FOXWQ_API_BASE}/YHWQFetchChessList`;
    const params = new URLSearchParams({
      srcuid: "0",
      dstuid: uid,
      type: "1",
      lastcode,
      searchkey: "",
      uin: uid,
    });

    // 通过 NetworkManager.request()，让策略层选择 ProxyProvider
    const response = await this.network.request<FoxwqChessListResponse>({
      url: `${url}?${params}`,
      method: "GET",
    });

    if (response.data.result !== 0) {
      const errorMsg = response.data.resultstr || "获取棋谱列表失败";
      throw new Error(errorMsg);
    }

    return response.data.chesslist || [];
  }

  /**
   * 下载单局 SGF
   */
  async fetchSGF(chessid: string): Promise<string> {
    const url = `${FOXWQ_API_BASE}/YHWQFetchChess`;
    const params = new URLSearchParams({ chessid });

    const response = await this.network.request<FoxwqSgfResponse>({
      url: `${url}?${params}`,
      method: "GET",
    });

    if (response.data.result !== 0) {
      throw new Error(`下载棋谱失败: ${response.data.resultstr || "无法获取棋谱内容"}`);
    }

    if (!response.data.chess) {
      throw new Error("下载棋谱失败: 棋谱内容为空");
    }

    return response.data.chess;
  }
}
