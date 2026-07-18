/**
 * @fileoverview 新网站棋手查询客户端
 * @description 直接访问 JSON 数据，无需代理
 */

import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { YichafenResult, YichafenData } from './types';
import { YEYUWEIQI_HEADERS, getSnapshotCandidates } from './YichafenUrls';

/** 棋手数据格式（新网站） */
interface PlayerData {
  姓名: string;
  性别?: string;
  出生?: string;
  段位?: string;
  等级分?: number;
  全国排名?: number;
  省区排名?: number;
  本市排名?: number;
  省区?: string;
  城市?: string;
  升段信息?: string;
  特别说明?: string;
}

/**
 * 棋手查询客户端
 * @description 直接访问新网站 JSON 数据，无需代理服务器
 */
export class YichafenClient {
  /** 缓存的棋手数据 */
  private cachedPlayers: PlayerData[] | null = null;
  /** 缓存时间 */
  private cachedAt = 0;
  /** 缓存有效期（1小时） */
  private readonly CACHE_TTL = 60 * 60 * 1000;

  /**
   * 查询棋手信息
   * @param name - 棋手姓名
   * @param config - 配置
   * @param network - 网络管理器
   * @param exact - 是否精确匹配（默认 false，支持模糊匹配）
   * @returns 查询结果（多个同名棋手）
   */
  async query(
    name: string,
    config: { timeout: number },
    network: NetworkManager,
    exact: boolean = false
  ): Promise<YichafenResult> {
    try {
      const players = await this.loadPlayers(network, config.timeout);

      if (!players || players.length === 0) {
        return { found: false, error: '无法获取棋手数据' };
      }

      // 搜索棋手（支持模糊匹配，返回所有匹配结果）
      const matched = this.searchPlayers(players, name, exact);

      if (matched.length === 0) {
        return { found: false };
      }

      // 返回第一个结果（兼容旧接口）
      const first = matched[0];
      if (!first) {
        return { found: false };
      }
      return { found: true, data: this.mapData(first), matches: matched.map(p => this.mapData(p)) };
    } catch (error) {
      return { found: false, error: String(error) };
    }
  }

  /**
   * 搜索棋手
   */
  private searchPlayers(players: PlayerData[], name: string, exact: boolean): PlayerData[] {
    if (exact) {
      return players.filter(p => p.姓名 === name);
    }
    // 模糊匹配：姓名包含查询词，或查询词包含姓名
    return players.filter(p => p.姓名.includes(name) || name.includes(p.姓名));
  }

  /**
   * 加载棋手数据（使用缓存）
   */
  private async loadPlayers(network: NetworkManager, timeout: number): Promise<PlayerData[]> {
    // 检查缓存
    if (this.cachedPlayers && Date.now() - this.cachedAt < this.CACHE_TTL) {
      return this.cachedPlayers;
    }

    // 统一：优先从本地静态资源加载 gzip 压缩文件（Web 和 App 共享）
    const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
    const localCandidates = getSnapshotCandidates(3).map(url =>
      url.replace('https://yeyuweiqi.cn/rankings/月度榜单/', '../shared/assets/data/rankings/') + '.gz'
    );

    for (const localPath of localCandidates) {
      try {
        const response = await fetch(localPath);
        if (response.ok) {
          // 尝试检测数据是否已被浏览器自动解压
          // 方法：先尝试读取一小部分数据，检查是否是 gzip 格式
          const reader = response.body!.getReader();
          const { value: firstChunk } = await reader.read();
          
          // 检查 gzip 魔数 (1f 8b)
          const isGzipData = firstChunk && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;
          
          let data;
          if (isGzipData) {
            // 数据是 gzip 格式，需要手动解压
            // 重新构造 ReadableStream
            const stream = new ReadableStream({
              async start(controller) {
                controller.enqueue(firstChunk);
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
                controller.close();
              }
            });
            
            const decompressedStream = stream.pipeThrough(
              new DecompressionStream('gzip')
            );
            const decompressedReader = decompressedStream.getReader();
            const decoder = new TextDecoder();
            let jsonText = '';

            while (true) {
              const { done, value } = await decompressedReader.read();
              if (done) break;
              jsonText += decoder.decode(value, { stream: true });
            }

            data = JSON.parse(jsonText);
          } else {
            // 数据已被浏览器自动解压，直接解析 JSON
            const decoder = new TextDecoder();
            let jsonText = decoder.decode(firstChunk, { stream: true });
            
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              jsonText += decoder.decode(value, { stream: true });
            }
            
            data = JSON.parse(jsonText);
          }

          this.cachedPlayers = data;
          this.cachedAt = Date.now();
          console.info(`[YichafenClient] Local data loaded: ${localPath}`);
          return data;
        }
      } catch (error) {
        // 外部输入容错：文件不存在或格式错误是预期情况，不影响功能
        console.info(`[YichafenClient] Local file not available: ${localPath}`);
      }
    }

    // Web 端：本地资源不可用时，不发起远程请求，直接返回空
    // App 端：fallback 到远程加载
    if (!isApp) {
      return [];
    }

    // App 端 fallback：本地资源不可用时，从远程加载
    // 获取最近 3 个月的榜单候选
    const candidates = getSnapshotCandidates(3);
    let lastError: Error | null = null;

    // 尝试加载，直到找到可用的文件
    for (const url of candidates) {
      try {
        const response = await network.request<PlayerData[]>({
          url,
          method: 'GET',
          headers: {
            // 使用自定义头，避免浏览器忽略标准的 User-Agent 和 Referer
            // ProxyProvider 会自动转换为 X-User-Agent 和 X-Referer
            'X-User-Agent': YEYUWEIQI_HEADERS['User-Agent'],
            'X-Referer': YEYUWEIQI_HEADERS['Referer'],
          },
          timeout,
        });

        if (response?.data && response.data.length > 0) {
          this.cachedPlayers = response.data;
          this.cachedAt = Date.now();
          return response.data;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[YichafenClient] Failed to load ${url}:`, error);
      }
    }

    // 所有请求都失败，抛出最后一个错误
    if (lastError) {
      throw lastError;
    }

    return [];
  }

  /**
   * 映射数据格式
   */
  private mapData(player: PlayerData): YichafenData {
    const data: YichafenData = {
      name: player.姓名,
      level: player.段位 ?? '',
    };

    if (player.等级分 !== undefined) data.rating = player.等级分;
    if (player.全国排名 !== undefined) data.totalRank = player.全国排名;
    if (player.省区排名 !== undefined) data.provinceRank = player.省区排名;
    if (player.本市排名 !== undefined) data.cityRank = player.本市排名;
    if (player.省区) data.province = player.省区;
    if (player.城市) data.city = player.城市;
    if (player.性别) data.gender = player.性别;
    if (player.出生) data.birthYear = parseInt(player.出生);

    const notes = [player.升段信息, player.特别说明].filter(Boolean).join(' | ');
    if (notes) data.notes = notes;

    return data;
  }
}
