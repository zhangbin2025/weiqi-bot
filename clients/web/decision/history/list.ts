/**
 * 历史记录列表渲染
 * @description 加载并渲染历史记录列表
 */

import { IFavoriteService } from '../../../../services/favorite/IFavoriteService';
import { resolveDecisionSourceLabel } from '../../../../application/decision';

/**
 * 加载历史记录列表
 */
export async function loadHistoryList(favoriteService: IFavoriteService | undefined): Promise<void> {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;
  
  try {
    const favorites = await favoriteService?.getFavorites({ category: 'decision_generate' });
    
    if (!favorites || favorites.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div>暂无历史记录</div>
        </div>
      `;
      return;
    }
    
    // 按时间倒序排列
    const sortedFavorites = favorites.sort((a, b) => b.createdAt - a.createdAt);
    
    historyList.innerHTML = sortedFavorites.map(fav => {
      const label = (fav.data?.['label'] as string) || '未知';
      // 展示标签：新数据取落库的 sourceLabel；老数据靠收藏键 import_ 前缀识别为「导入棋谱」
      const sourceLabel = resolveDecisionSourceLabel(fav.data as Record<string, unknown> | undefined, fav.key);
      const gamesCount = (fav.data?.['gamesCount'] as number) || 0;
      const quizGamesCount = (fav.data?.['quizGamesCount'] as number) || 0;
      const problemsCount = (fav.data?.['problemsCount'] as number) || 0;
      const stats = fav.data?.['stats'] as any;
      const date = new Date(fav.createdAt).toLocaleString('zh-CN');
      
      // 来源标签 → 爬取 URL（导入的展示名）占满一行，
      // URL 不能断行（break-all 会把一个豆号拆开）；
      // 不同行则 URL 会把标签挤到下一行，两者互相影响。
      // 所以 URL 独占一行（history-url），标签行只放来源标签。
      return `
        <div class="history-item" data-id="${fav.id}">
          <div class="history-header">
            <div class="history-title"><span class="history-source">${sourceLabel}</span></div>
            <span class="history-date">${date}</span>
          </div>
          ${label ? `<div class="history-url" title="${label}">${label}</div>` : ''}
          <div class="history-meta">
            <span class="meta-phase">🌅${stats?.phases?.layout ?? 0}</span>
            <span class="meta-phase">⚔️${stats?.phases?.middle ?? 0}</span>
            <span class="meta-phase">🔚${stats?.phases?.endgame ?? 0}</span>
            <span class="meta-levels">
              ${stats?.levels?.pro ? `<span class="level-tag pro">职业 ${stats.levels.pro}</span>` : ''}
              ${stats?.levels?.high ? `<span class="level-tag high">高段 ${stats.levels.high}</span>` : ''}
              ${stats?.levels?.normal ? `<span class="level-tag normal">普通 ${stats.levels.normal}</span>` : ''}
            </span>
          </div>
        </div>
      `;
    }).join('');
    
    // 绑定点击事件
    historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = (item as HTMLElement).dataset['id'];
        if (id) {
          // 跳转到题目列表页面
          window.location.href = `list.html?favoriteId=${id}`;
        }
      });
    });
    
  } catch (e) {
    console.error('加载历史记录失败', e);
  }
}
