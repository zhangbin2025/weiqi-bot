/**
 * 定式探索收藏管理器
 * @description 处理收藏列表的加载、渲染、添加
 */
import { createJosekiThumbnail } from '../../../components/JosekiThumbnail';
import type { JosekiExploreApp, FavoriteEntry } from '../../../../../../application/joseki';
import type { IReadMarkService } from '../../../../../../services/readmark';
import { READ_MARK_CATEGORIES } from '../../../../../../services/readmark/types';
import { Dialog } from '@ui';
/** 收藏管理器配置 */
export interface ExploreFavoritesManagerConfig {
  exploreApp: JosekiExploreApp;
  readMarkService: IReadMarkService;
  onLoadFavorite: (path: string[]) => void;
}
/**
 * 收藏管理器
 */
export class ExploreFavoritesManager {
  private favorites: FavoriteEntry[] = [];
  private readMarkIds: string[] = [];
  constructor(private config: ExploreFavoritesManagerConfig) {}
  /** 加载收藏列表 */
  async loadFavorites(): Promise<void> {
    try {
      this.favorites = await this.config.exploreApp.queryFavorites({ limit: 50 });
      this.readMarkIds = await this.config.readMarkService.getReadMarks(READ_MARK_CATEGORIES.OPPONENT_JOSEKI);
      this.renderFavorites();
    } catch (error) {
      this.favorites = [];
    }
  }
  /** 渲染收藏列表 */
  private renderFavorites(): void {
    const container = document.getElementById('favorites-list');
    if (!container) return;
    if (this.favorites.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div>暂无收藏</div>
          <div style="font-size:0.85em;margin-top:8px;">探索定式时点击收藏按钮添加</div>
        </div>
      `;
      return;
    }
    // 改用卡片式布局
    container.innerHTML = this.favorites.map(f => {
      const moves = this.parsePathToMoves(f.path);
      const timeText = f.createdAt ? this.formatDate(f.createdAt) : '';
      return `
        <div class="favorite-item" data-id="${f.id}">
          <div class="favorite-thumb"></div>
          <div class="favorite-info">
            <div class="favorite-moves">${moves.length} 手定式</div>
            ${timeText ? `<div class="favorite-time">${timeText}</div>` : ''}
          </div>
          <div class="favorite-actions">
            <button class="favorite-delete-btn" data-delete-id="${f.id}" title="删除">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
    // 渲染缩略图
    container.querySelectorAll('.favorite-item').forEach(item => {
      const id = (item as HTMLElement).dataset['id'];
      const entry = this.favorites.find(f => f.id === id);
      if (!entry) return;
      const wrapper = item.querySelector('.favorite-thumb');
      if (wrapper) {
        const moves = this.parsePathToMoves(entry.path);
        const canvas = createJosekiThumbnail(moves, 80);
        wrapper.appendChild(canvas);
      }
    });
    // 绑定点击事件（加载收藏）
    container.querySelectorAll('.favorite-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 阻止冒泡，避免点击删除按钮时触发加载
        if ((e.target as HTMLElement).classList.contains('favorite-delete-btn')) return;
        const id = (item as HTMLElement).dataset['id'];
        if (id) this.loadFavoriteToExplore(id);
      });
    });
    // 绑定删除事件
    container.querySelectorAll('.favorite-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset['deleteId'];
        if (id && (await Dialog.confirm('确定删除这个收藏吗？'))) {
          await this.deleteFavorite(id);
        }
      });
    });
  }
  /** 加载收藏到探索 */
  private async loadFavoriteToExplore(id: string): Promise<void> {
    const entry = this.favorites.find(f => f.id === id);
    if (!entry) return;
    // 调用回调，让主控制器处理标签切换和路径加载
    this.config.onLoadFavorite(entry.path);
  }
  /** 解析路径为着法数组 */
  private parsePathToMoves(path: string[]): Array<{x: number; y: number; color: 'black' | 'white'; isPass: boolean}> {
    return path.map((coord, i) => {
      const isPass = coord === 'tt';
      return {
        x: isPass ? -1 : coord.charCodeAt(0) - 97,
        y: isPass ? -1 : coord.charCodeAt(1) - 97,
        color: i % 2 === 0 ? 'black' as const : 'white' as const,
        isPass
      };
    });
  }
  /** 获取收藏列表 */
  getFavorites(): FavoriteEntry[] {
    return this.favorites;
  }
  /** 删除单个收藏 */
  async deleteFavorite(id: string): Promise<void> {
    try {
      await this.config.exploreApp.removeFavorite(id);
      this.favorites = this.favorites.filter(f => f.id !== id);
      this.renderFavorites();
    } catch (error) {
      console.error('删除失败', error);
    }
  }
  /** 格式化日期 */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  /** 重置 */
  reset(): void {
    this.favorites = [];
    this.readMarkIds = [];
  }
}
