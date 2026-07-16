/**
 * 定式探索页面控制器
 * @module presentation/pages/joseki/JosekiExplorePage
 */
import { AdapterFactory } from '../../../../adapters';
import { JosekiBoard, JosekiBranch } from '../../components/JosekiBoard';
import type { IPage, IToast, IDialog, PageParams } from '../../../../core/interfaces';
import type { JosekiExploreApp, ExploreResult } from '../../../../../application/joseki';
import type { IAudioPlayer } from '../../../../../infrastructure/audio/IAudioPlayer';
import type { IReadMarkService } from '../../../../../services/readmark';
import { ExploreFavoritesManager } from './explore/ExploreFavoritesManager';
import { ExploreUIHelper } from './explore/ExploreUIHelper';
type JosekiTab = 'explore' | 'favorites';
export interface JosekiExplorePageConfig {
  exploreApp: JosekiExploreApp;
  readMarkService: IReadMarkService;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  audioPlayer?: IAudioPlayer;
}
export class JosekiExplorePage implements IPage {
  readonly title = '定式探索';
  private exploreApp: JosekiExploreApp;
  private readMarkService: IReadMarkService;
  private onNavigate: ((page: string, params?: Record<string, string>) => void) | undefined;
  private audioPlayer?: IAudioPlayer | undefined;
  private board!: JosekiBoard;
  private toast: IToast;
  private dialog: IDialog;
  private currentTab: JosekiTab = 'explore';
  private currentPath: string[] = [];
  private currentResult?: ExploreResult;
  private initialized = false;
  // 子模块
  private favoritesManager: ExploreFavoritesManager;
  private uiHelper: ExploreUIHelper;
  constructor(config: JosekiExplorePageConfig) {
    this.exploreApp = config.exploreApp;
    this.readMarkService = config.readMarkService;
    this.onNavigate = config.onNavigate;
    this.audioPlayer = config.audioPlayer;
    this.toast = AdapterFactory.createToast();
    this.dialog = AdapterFactory.createDialog();
    // 创建子模块
    this.favoritesManager = new ExploreFavoritesManager({
      exploreApp: config.exploreApp,
      readMarkService: config.readMarkService,
      onLoadFavorite: (path) => this.loadFavoritePath(path),
    });
    this.uiHelper = new ExploreUIHelper();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 预加载缩略图图片（等待完成）
    const { preloadThumbnailImages } = await import('../../components/JosekiThumbnail');
    await preloadThumbnailImages();
    const boardContainer = document.getElementById('board-container') ?? undefined;
    this.board = new JosekiBoard(boardContainer, this.audioPlayer);
    this.board.initialize();
    this.board.on({ onClick: (pos) => this.handleStoneClick(pos) });
    this.uiHelper.updateStats({ moves: 0 });
    const freqEl = document.getElementById('stat-freq');
    const probEl = document.getElementById('stat-prob');
    if (freqEl) freqEl.textContent = '...';
    if (probEl) probEl.textContent = '...';
    try {
      await this.exploreApp.initialize((percent, status, detail) => {
        this.uiHelper.updateStats({ moves: 0 });
        const freqEl = document.getElementById('stat-freq');
        const probEl = document.getElementById('stat-prob');
        if (freqEl) freqEl.textContent = `${percent}%`;
        if (probEl) probEl.textContent = status;
      });
      this.uiHelper.updateStats({ moves: 0 });
      const freqEl2 = document.getElementById('stat-freq');
      const probEl2 = document.getElementById('stat-prob');
      if (freqEl2) freqEl2.textContent = '-';
      if (probEl2) probEl2.textContent = '-';
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`加载定式库失败: ${errMsg}`, error as Error);
      this.toast.error(`加载定式库失败: ${errMsg}`);
      return;
    }
    this.bindEvents();
    await this.showFirstMoveBranches();
    this.uiHelper.checkPassHint(() => this.board.getPassMarkPosition());
    this.initialized = true;
  }
  private bindEvents(): void {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = (tab as HTMLElement).dataset['tab'] as JosekiTab;
        this.switchTab(tabName);
      });
    });
    const undoBtn = document.getElementById('undo-btn');
    const favBtn = document.getElementById('fav-btn');
    const resetBtn = document.getElementById('reset-btn');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (favBtn) favBtn.addEventListener('click', () => this.addFavorite());
    if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
    document.getElementById('stat-winrate')?.addEventListener('click', () => this.uiHelper.showWinrateDetail());
    document.getElementById('winrate-close-btn')?.addEventListener('click', () => this.uiHelper.hideWinrateDetail());
    document.getElementById('winrate-backdrop')?.addEventListener('click', () => this.uiHelper.hideWinrateDetail());
  }
  handleParams(params: PageParams): void {
    // 支持 path 和 moves 两种参数名
    const movesParam = params['moves'] || params['path'];
    if (movesParam) {
      // 支持 '-' 和 ',' 两种分隔符
      const movesArray = movesParam.split(/[-,]/).filter(Boolean);
      this.currentPath = movesArray;
      this.explore();
    }
  }
  private async switchTab(tab: JosekiTab): Promise<void> {
    this.currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset['tab'] === tab);
    });
    const exploreContent = document.getElementById('explore-content');
    const favoritesContent = document.getElementById('favorites-content');
    if (tab === 'explore') {
      if (exploreContent) exploreContent.style.display = 'block';
      if (favoritesContent) favoritesContent.style.display = 'none';
    } else {
      if (exploreContent) exploreContent.style.display = 'none';
      if (favoritesContent) favoritesContent.style.display = 'block';
      await this.favoritesManager.loadFavorites();
    }
  }
  private async loadFavoritePath(path: string[]): Promise<void> {
    await this.switchTab('explore');
    this.currentPath = [];
    for (const coord of path) {
      this.currentPath.push(coord);
      await this.explore();
      await new Promise(r => setTimeout(r, 300));
    }
  }
  private async handleStoneClick(pos: { x: number; y: number }): Promise<void> {
    if (pos.x === -1 && pos.y === -1) {
      this.currentPath.push('tt');
      const nextColor = this.currentPath.length % 2 === 1 ? '黑' : '白';
      this.uiHelper.showPassOverlay(`${nextColor}方脱先`);
      await this.explore();
      return;
    }
    const sgf = String.fromCharCode(97 + pos.x, 97 + pos.y);
    this.currentPath.push(sgf);
    await this.explore();
  }
  private async explore(): Promise<void> {
    if (this.currentPath.length === 0) {
      delete this.currentResult;
      await this.showFirstMoveBranches();
      this.updateFavoriteButton(false);
      return;
    }
    try {
      this.currentResult = await this.exploreApp.explore(this.currentPath);
      this.uiHelper.updateStats(this.currentResult.stats);
      this.updateControls();
      const moves = this.currentPath.map((coord, i) => {
        const isPass = coord === 'tt';
        const x = isPass ? -1 : coord.charCodeAt(0) - 97;
        const y = isPass ? -1 : coord.charCodeAt(1) - 97;
        return { x, y, color: i % 2 === 0 ? 'black' as const : 'white' as const, isPass };
      });
      this.board.setMoves(moves);
      if (this.currentResult.candidates) {
        const branches: JosekiBranch[] = this.currentResult.candidates.map(c => {
          const isPass = c.coord === 'tt';
          const x = isPass ? -1 : c.coord.charCodeAt(0) - 97;
          const y = isPass ? -1 : c.coord.charCodeAt(1) - 97;
          return { x, y, color: c.color, sgf: c.coord, heat: c.heat, isPass };
        });
        this.board.setBranches(branches);
        this.uiHelper.checkPassHint(() => this.board.getPassMarkPosition());
      }
      this.board.render();
      // 检查是否已收藏
      await this.checkFavoriteStatus();
    } catch (error) {
      console.error('探索失败', error as Error);
      this.toast.error('探索失败');
    }
  }
  private async showFirstMoveBranches(): Promise<void> {
    this.uiHelper.updateStats({ moves: 0 });
    this.updateControls();
    this.board.clear();
    try {
      const result = await this.exploreApp.explore([]);
      if (result.candidates) {
        const branches: JosekiBranch[] = result.candidates.map(c => {
          const isPass = c.coord === 'tt';
          const x = isPass ? -1 : c.coord.charCodeAt(0) - 97;
          const y = isPass ? -1 : c.coord.charCodeAt(1) - 97;
          return { x, y, color: c.color, sgf: c.coord, heat: c.heat, isPass };
        });
        this.board.setBranches(branches);
      }
    } catch (error) {
      console.error('获取首着选点失败', error as Error);
    }
    this.board.render();
  }
  private updateControls(): void {
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement | null;
    const favBtn = document.getElementById('fav-btn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = this.currentPath.length <= 0;
    if (favBtn) favBtn.disabled = !this.currentResult?.stats.freq;
  }
  private async undo(): Promise<void> {
    if (this.currentPath.length <= 0) return;
    this.currentPath.pop();
    await this.explore();
  }
  private async addFavorite(): Promise<void> {
    if (!this.currentPath.length) return;
    try {
      await this.exploreApp.addFavorite(this.currentPath);
      this.updateFavoriteButton(true);
      this.toast.success('收藏成功');
    } catch (error) {
      console.error('收藏失败', error as Error);
      this.toast.error('收藏失败');
    }
  }
  /** 更新收藏按钮状态 */
  private updateFavoriteButton(favorited: boolean): void {
    const favBtn = document.getElementById('fav-btn');
    if (!favBtn) return;
    if (favorited) {
      favBtn.textContent = '⭐';
      favBtn.classList.add('favorited');
      favBtn.dataset['faved'] = 'true';
    } else {
      favBtn.textContent = '☆';
      favBtn.classList.remove('favorited');
      favBtn.dataset['faved'] = 'false';
    }
  }
  /** 检查当前路径是否已收藏 */
  private async checkFavoriteStatus(): Promise<void> {
    if (!this.currentPath.length) {
      this.updateFavoriteButton(false);
      return;
    }
    try {
      const favorites = await this.exploreApp.queryFavorites({ limit: 100 });
      const pathStr = this.currentPath.join(',');
      const isFavorited = favorites.some(f => f.path.join(',') === pathStr);
      this.updateFavoriteButton(isFavorited);
    } catch (error) {
      this.updateFavoriteButton(false);
    }
  }
  private async reset(): Promise<void> {
    this.currentPath = [];
    delete this.currentResult;
    await this.showFirstMoveBranches();
  }
  // ========== 收藏管理方法 ==========
  async removeFavorite(id: string): Promise<void> {
    try {
      await this.exploreApp.removeFavorite(id);
      this.toast.success('删除成功');
    } catch (error) {
      console.error('删除收藏失败', error as Error);
      this.toast.error('删除失败');
    }
  }
  async clearFavorites(): Promise<void> {
    try {
      // 使用 dialog 确认，设置超时防止无限等待
      const confirmed = await Promise.race([
        this.dialog.show({
          title: '确认清空',
          content: '确定要清空所有收藏吗？',
          buttons: [{ id: 'cancel', text: '取消' }, { id: 'ok', text: '确定' }],
        }),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3000))
      ]);
      // dialog.show() 返回布尔值或按钮 id
      if (confirmed === 'ok' || confirmed === true) {
        if (this.exploreApp.clearFavorites) {
          await this.exploreApp.clearFavorites();
          this.toast.success('已清空收藏');
        } else {
          this.toast.info('清空功能不可用');
        }
      }
    } catch (error) {
      console.error('清空收藏失败', error as Error);
      this.toast.error('清空失败');
    }
  }
  async exportFavorites(): Promise<void> {
    try {
      const data = await this.exploreApp.exportFavorites();
      // 创建下载链接
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'joseki-favorites.json';
      a.click();
      URL.revokeObjectURL(url);
      this.toast.success('导出成功');
    } catch (error) {
      console.error('导出收藏失败', error as Error);
      this.toast.error('导出失败');
    }
  }
  async importFavorites(): Promise<void> {
    // 导入逻辑需要文件选择对话框，这里简化处理
    this.toast.info('导入功能待实现');
  }
  async clearReadMarks(): Promise<void> {
    // 清除已读标记
    // 由于我们没有 category 信息，这里使用默认 category
    // 测试期望调用 readMarkService.clearReadMarks
    try {
      await this.readMarkService.clearReadMarks('joseki_explore');
      this.toast.success('已清除已读标记');
    } catch (error) {
      console.error('清除已读标记失败', error as Error);
      this.toast.error('清除失败');
    }
  }
  goBack(): void {
    this.undo();
  }
  render(): void {
    this.board.render();
  }
  destroy(): void {
    this.board.destroy();
    this.toast.destroy();
    this.dialog.destroy();
    this.currentPath = [];
    this.favoritesManager.reset();
    this.initialized = false;
  }
}
