/**
 * 直播缓存工具
 * 缓存 URL 到最新 archiveId 的映射
 */

import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

// 缓存 TTL：1 天
const LIVE_CACHE_TTL = 24 * 60 * 60 * 1000;

// 共享存储适配器单例
const storage = new LocalStorageAdapter('weiqi-bot');

/**
 * 对 URL 进行 hash（用于生成缓存 key）
 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'live-archive-' + Math.abs(hash).toString(36);
}

/**
 * 保存直播 URL 对应的最新 archiveId
 */
export async function saveLiveArchiveId(liveUrl: string, archiveId: string): Promise<void> {
  try {
    await storage.initialize();
    const key = hashUrl(liveUrl);
    const data = {
      archiveId,
      timestamp: Date.now(),
    };
    await storage.write(key, data);
    console.log('[LiveCache] 保存映射:', key, '->', archiveId);
  } catch (error) {
    console.warn('[LiveCache] 保存失败:', error);
  }
}

/**
 * 加载直播 URL 对应的最新 archiveId
 */
export async function loadLiveArchiveId(liveUrl: string): Promise<string | null> {
  try {
    await storage.initialize();
    const key = hashUrl(liveUrl);
    const data = await storage.read<{ archiveId: string; timestamp: number }>(key);
    if (!data) {
      console.log('[LiveCache] 未命中:', key);
      return null;
    }

    // 检查是否过期
    if (Date.now() - data.timestamp > LIVE_CACHE_TTL) {
      console.log('[LiveCache] 已过期:', key);
      await storage.delete(key);
      return null;
    }

    console.log('[LiveCache] 命中:', key, '->', data.archiveId);
    return data.archiveId;
  } catch (error) {
    console.warn('[LiveCache] 加载失败:', error);
    return null;
  }
}
