/**
 * @fileoverview Game 服务类型定义
 */

import type { FetchResult } from './providers/base/types';

/** 批量下载进度回调 */
export interface FetchProgressCallback {
  (current: number, total: number, currentId: string): void;
}

/**
 * 棋谱服务结果（包含归档ID）
 */
export interface GameServiceResult {
  /** 是否成功 */
  success: boolean;
  /** 归档ID（成功时） */
  archiveId: string;
  /** SGF 内容 */
  sgfContent: string | null;
  /** 来源标识 */
  source: string;
  /** 原始 URL */
  url: string;
  /** 游戏元数据 */
  metadata: FetchResult['metadata'];
  /** 是否来自缓存 */
  fromCache: boolean;
  /** 错误信息（失败时） */
  error?: string | undefined;
}

/**
 * Game 服务接口
 *
 * 提供统一的棋谱下载服务，自动路由到不同的平台提供者。
 * 所有下载结果都会归档到历史记录。
 *
 * @ai-example
 * const service: IGameService = new GameService(network, options);
 * const result = await service.fetch('https://online-go.com/game/12345');
 * console.log(result.archiveId, result.sgfContent);
 */
export interface IGameService {
  /**
   * 从 URL 下载棋谱（统一入口）
   * @param url - 游戏页面 URL
   * @returns 下载结果（包含归档ID）
   * @ai-example
   * const result = await service.fetch('https://online-go.com/game/12345');
   */
  fetch(url: string): Promise<GameServiceResult>;

  /**
   * 批量下载棋谱
   * @param urls - 游戏 URL 列表
   * @returns 下载结果列表
   */
  fetchMany(urls: string[]): Promise<GameServiceResult[]>;

  /**
   * 检测 URL 是否支持
   * @param url - 待检测的 URL
   * @returns 是否支持
   */
  canHandle(url: string): boolean;

  /**
   * 获取棋手的棋谱 URL 列表（不下载）
   * @param player - 棋手昵称
   * @param count - 最大数量，默认 5
   * @returns 棋谱 ID 列表
   */
  listPlayerGames(player: string, count?: number): Promise<string[]>;

  /**
   * 获取最新公开棋谱 URL 列表（不下载）
   * @param date - 日期过滤（格式 'YYYY-MM-DD'，可选）
   * @param count - 最大数量，默认 10
   * @returns 棋谱 URL 列表
   */
  listPublicGames(date?: string, count?: number): Promise<string[]>;

  /**
   * 批量下载棋谱（通过 chessid 列表）
   * @description 专门用于野狐平台，通过 chessid 直接下载 SGF
   * @param chessids - 棋谱 ID 列表
   * @param options - 可选配置（包含进度回调）
   * @returns 下载结果列表
   */
  fetchByChessIds(
    chessids: string[],
    options?: { onProgress?: FetchProgressCallback }
  ): Promise<GameServiceResult[]>;

  /**
   * 获取支持的提供者列表
   * @returns 提供者名称列表
   */
  getSupportedProviders(): string[];

  /**
   * 按归档ID获取棋谱内容
   * @param archiveId - 归档ID
   * @returns SGF内容，不存在返回 null
   */
  getByArchiveId(archiveId: string): Promise<string | null>;
}
