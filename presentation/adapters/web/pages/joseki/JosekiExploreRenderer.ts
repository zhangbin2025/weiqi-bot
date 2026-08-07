/**
 * 定式探索页面渲染辅助
 * @module presentation/pages/joseki/JosekiExploreRenderer
 */
import type { IBoard, ICard } from '../../../../core/interfaces';
import type { ExploreResult, FavoriteEntry } from '../../../../../application/joseki';
import { renderWinrateDetail } from '../common/WinrateDetailRenderer';
/** 渲染探索结果 */
export function renderExplore(board: IBoard, card: ICard, currentPath: string[], result?: ExploreResult): void {
  board.render();
  if (!result) {
    card.setContent('点击棋盘开始探索定式');
    card.render();
    return;
  }
  const info = [
    `路径: ${currentPath.join(' → ') || '开始'}`,
    `统计: ${result.stats.moves} 手`,
    `频率: ${result.stats.freq}`,
    result.stats.winrate ? `胜率: +${(result.stats.winrate.delta * 100).toFixed(1)}%` : '',
  ].filter(Boolean).join('\n');
  card.setContent(info);
  card.render();
}
/** 渲染收藏列表 */
export function renderFavorites(card: ICard, favorites: FavoriteEntry[], readMarkIds: string[]): void {
  if (favorites.length === 0) {
    card.setContent('暂无收藏\n\n探索定式时点击收藏按钮添加');
    card.render();
    return;
  }
  const content = favorites.map((entry, index) => {
    const isRead = readMarkIds.includes(entry.id);
    const mark = isRead ? '○' : '●';
    return `${mark} ${index + 1}. ${entry.path.slice(0, 5).join(' → ')}${entry.path.length > 5 ? '...' : ''}`;
  }).join('\n\n');
  card.setContent(`已收藏 ${favorites.length} 条\n\n${content}`);
  card.render();
}
/** 位置转坐标字符串 */
export function posToCoord(pos: { x: number; y: number }): string {
  return String.fromCharCode(97 + pos.x - 1) + String.fromCharCode(97 + pos.y - 1);
}
