/**
 * 历史记录列表渲染
 * @description 加载并渲染历史记录列表
 */

import { IFavoriteService } from '../../../../services/favorite/IFavoriteService';

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
      const gamesCount = (fav.data?.['gamesCount'] as number) || 0;
      const quizGamesCount = (fav.data?.['quizGamesCount'] as number) || 0;
      const problemsCount = (fav.data?.['problemsCount'] as number) || 0;
      const stats = fav.data?.['stats'] as any;
      const date = new Date(fav.createdAt).toLocaleString('zh-CN');
      
      return `
        <div class="history-item" data-id="${fav.id}">
          <div class="history-header">
            <div class="history-title"><span class="history-source">野狐</span> ${label}</div>
          </div>
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
