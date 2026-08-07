/**
 * 直播缓存工具
 * 缓存 URL 到最新 archiveId 的映射
 */

// 缓存 TTL：1 天
const LIVE_CACHE_TTL = 24 * 60 * 60 * 1000;

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
export function saveLiveArchiveId(liveUrl: string, archiveId: string): void {
  try {
    const key = hashUrl(liveUrl);
    const data = {
      archiveId,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
    console.log('[LiveCache] 保存映射:', key, '->', archiveId);
  } catch (error) {
    console.warn('[LiveCache] 保存失败:', error);
  }
}

/**
 * 加载直播 URL 对应的最新 archiveId
 */
export function loadLiveArchiveId(liveUrl: string): string | null {
  try {
    const key = hashUrl(liveUrl);
    const data = localStorage.getItem(key);
    if (!data) {
      console.log('[LiveCache] 未命中:', key);
      return null;
    }

    const cached = JSON.parse(data);

    // 检查是否过期
    if (Date.now() - cached.timestamp > LIVE_CACHE_TTL) {
      console.log('[LiveCache] 已过期:', key);
      localStorage.removeItem(key);
      return null;
    }

    console.log('[LiveCache] 命中:', key, '->', cached.archiveId);
    return cached.archiveId;
  } catch (error) {
    console.warn('[LiveCache] 加载失败:', error);
    return null;
  }
}
