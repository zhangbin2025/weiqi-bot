/**
 * 收藏管理模块
 */

import type { OpponentBookmark, OpponentAnalysisResultWithBookmark } from '../../application/opponent';
import { formatRelativeTime } from './utils';
import { Dialog } from '../shared/ui';

// 收藏列表
let favorites: OpponentBookmark[] = [];

/**
 * 加载收藏列表
 */
export async function loadFavorites(
  analyzer: any,
  favoritesList: HTMLElement
): Promise<void> {
  try {
    favorites = await analyzer.getFavorites();
    renderFavoritesList(favoritesList);
  } catch (error) {
    console.error('[OpponentPage] 加载收藏失败', error);
    favorites = [];
    renderFavoritesList(favoritesList);
  }
}

/**
 * 渲染收藏列表
 */
function renderFavoritesList(favoritesList: HTMLElement): void {
  if (favorites.length === 0) {
    favoritesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⭐</div>
        <p>暂无收藏</p>
        <p style="font-size: 0.85em; margin-top: 8px;">分析对手后会显示在这里</p>
      </div>
    `;
    return;
  }

  favoritesList.innerHTML = favorites.map(bookmark => {
    const gamesCount = bookmark.games?.length ?? 0;
    const josekiCount = bookmark.joseki?.count ?? 0;
    const time = formatRelativeTime(bookmark.updatedAt);

    return `
      <div class="history-item" onclick="window.viewFavorite('${bookmark.foxwqId}')">
        <div class="history-header">
          <span class="history-id">👤 ${bookmark.foxwqId}</span>
          <span class="history-time">${time}</span>
        </div>
        <div class="history-stats">
          <span class="history-stat">📋 ${gamesCount}局</span>
          <span class="history-stat">🎯 ${josekiCount}定式</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 清除所有收藏
 */
export async function clearFavorites(
  analyzer: any,
  favoritesList: HTMLElement
): Promise<void> {
  if (!(await Dialog.confirm('确定要清除所有收藏吗？'))) return;

  await analyzer.clearFavorites();
  favorites = [];
  renderFavoritesList(favoritesList);
}

/**
 * 根据ID获取收藏
 */
export function getFavorite(foxwqId: string): OpponentBookmark | undefined {
  return favorites.find(f => f.foxwqId === foxwqId);
}

/**
 * 从收藏构造分析结果
 */
export function buildResultFromBookmark(bookmark: OpponentBookmark): OpponentAnalysisResultWithBookmark {
  return {
    foxwqId: bookmark.foxwqId,
    userInfo: { uid: bookmark.foxwqId, nickname: bookmark.foxwqId },
    games: bookmark.games || [],
    joseki: bookmark.joseki || { count: 0, patterns: [] },
    analyzedAt: bookmark.analyzedAt || Date.now(),
  } as OpponentAnalysisResultWithBookmark;
}
