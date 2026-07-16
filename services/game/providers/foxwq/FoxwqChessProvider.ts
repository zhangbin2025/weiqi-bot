/**
 * @fileoverview 野狐围棋棋谱下载功能
 */

import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { FoxwqGame, FoxwqChessListResponse, FoxwqSgfResponse } from './types';

/** 野狐棋谱 API URL */
const FOXWQ_API_BASE = 'https://h5.foxwq.com/yehuDiamond/chessbook_local';

/**
 * 野狐围棋棋谱下载提供者
 */
export class FoxwqChessProvider {
  constructor(
    private readonly network: NetworkManager
  ) {}

  /**
   * 获取用户棋谱列表
   */
  async fetchChessList(uid: string, lastcode = '0'): Promise<FoxwqGame[]> {
    const url = `${FOXWQ_API_BASE}/YHWQFetchChessList`;
    const params = new URLSearchParams({
      srcuid: '0',
      dstuid: uid,
      type: '1',
      lastcode,
      searchkey: '',
      uin: uid,
    });

    // 通过 NetworkManager.request()，让策略层选择 ProxyProvider
    const response = await this.network.request<FoxwqChessListResponse>({
      url: `${url}?${params}`,
      method: 'GET',
    });

    if (response.data.result !== 0) {
      const errorMsg = response.data.resultstr || '获取棋谱列表失败';
      throw new Error(errorMsg);
    }

    return response.data.chesslist || [];
  }

  /**
   * 下载单局 SGF（支持多种方式）
   * 
   * 流程：
   * 1. 首先尝试直接用 chessid 下载
   * 2. 如果失败（result != 0），尝试通过 gamecode 获取正确的 chessid
   * 3. 用新的 chessid 再次下载
   */
  async fetchSGF(chessid: string): Promise<string> {
    // 第一种方式：直接下载
    const directResult = await this.tryFetchDirect(chessid);
    if (directResult) {
      return directResult;
    }

    // 第二种方式：通过 gamecode 获取 chessid 后再下载
    const convertedChessid = await this.getChessIdByGameCode(chessid);
    if (convertedChessid && convertedChessid !== chessid) {
      console.log(`[FoxwqChessProvider] chessid ${chessid} 无法获取，通过 gamecode 转换为 ${convertedChessid}`);
      const convertedResult = await this.tryFetchDirect(convertedChessid);
      if (convertedResult) {
        return convertedResult;
      }
    }

    // 所有方式都失败
    throw new Error(`下载棋谱失败: 无法获取棋谱内容`);
  }

  /**
   * 尝试直接下载棋谱
   */
  private async tryFetchDirect(chessid: string): Promise<string | null> {
    const url = `${FOXWQ_API_BASE}/YHWQFetchChess`;
    const params = new URLSearchParams({ chessid });

    try {
      const response = await this.network.request<FoxwqSgfResponse>({
        url: `${url}?${params}`,
        method: 'GET',
      });

      if (response.data.result === 0 && response.data.chess) {
        return response.data.chess;
      }

      // result != 0 或 chess 为空，返回 null 表示失败
      return null;
    } catch (error) {
      // 网络错误等，返回 null
      console.error(`[FoxwqChessProvider] 直接下载失败:`, error);
      return null;
    }
  }

  /**
   * 通过 gamecode 获取 chessid
   * 
   * 某些 URL 中的 chessid 参数实际上是 gamecode，需要转换
   */
  private async getChessIdByGameCode(gamecode: string): Promise<string | null> {
    const url = 'https://h5.foxwq.com/openChessManual/getchessIdbygamecode';
    const params = new URLSearchParams({ gamecode });

    try {
      const response = await this.network.request<{ result: number; chessid?: string }>({
        url: `${url}?${params}`,
        method: 'GET',
      });

      if (response.data.result === 0 && response.data.chessid) {
        return response.data.chessid;
      }

      return null;
    } catch (error) {
      console.error(`[FoxwqChessProvider] 获取 chessid 失败:`, error);
      return null;
    }
  }
}