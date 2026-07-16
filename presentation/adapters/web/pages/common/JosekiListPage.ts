/**
 * 公共定式列表页面
 * @module presentation/pages/common/JosekiListPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ITabs, IToast, PageParams } from '../../../../core/interfaces';
import type { IReadMarkService } from '../../../../../services/readmark';
import type { IGameService } from '../../../../../services/game';
import type { IJosekiDataProvider, IJosekiPattern } from './IJosekiDataProvider';
// 导出类型别名以保持向后兼容
export type JosekiPattern = IJosekiPattern;
import { JosekiFilterManager, JosekiFilter } from './joseki-list/JosekiFilterManager';
import { JosekiReadMarkManager } from './joseki-list/JosekiReadMarkManager';
import { JosekiWinrateHelper } from './joseki-list/JosekiWinrateHelper';
import { JosekiListRenderer } from './joseki-list/JosekiListRenderer';
/** 定式列表页面配置 */
export interface JosekiListPageConfig {
  readMarkService: IReadMarkService;
  providers: Map<string, IJosekiDataProvider>;
  gameService?: IGameService | undefined;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onClearReadMarks?: () => void;
  /** 默认分类（可选） */
  category?: string;
}
/** 公共定式列表页面 */
export class JosekiListPage implements IPage {
  get title(): string { return this._title; }
  private _title = '定式规律';
  private providers: Map<string, IJosekiDataProvider>;
  private gameService?: IGameService | undefined;
  private tabs: ITabs;
  private toast: IToast;
  private patterns: IJosekiPattern[] = [];
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private onClearReadMarks?: (() => void) | undefined;
  private initialized = false;
  // 子模块
  private filterManager: JosekiFilterManager;
  private readMarkManager: JosekiReadMarkManager;
  private winrateHelper: JosekiWinrateHelper;
  private renderer: JosekiListRenderer;
  constructor(config: JosekiListPageConfig) {
    this.providers = config.providers;
    this.gameService = config.gameService;
    this.onNavigate = config.onNavigate;
    this.onClearReadMarks = config.onClearReadMarks;
    this.tabs = AdapterFactory.createTabs();
    this.toast = AdapterFactory.createToast();
    // 创建子模块
    this.filterManager = new JosekiFilterManager();
    this.readMarkManager = new JosekiReadMarkManager(config.readMarkService);
    this.winrateHelper = new JosekiWinrateHelper();
    // 初始化默认分类
    if (config.category) {
      this.readMarkManager.setCategory(config.category);
    }
    this.renderer = new JosekiListRenderer({
      filterManager: this.filterManager,
      readMarkManager: this.readMarkManager,
      winrateHelper: this.winrateHelper,
      onExplore: (id) => this.explorePattern(id),
      onViewGame: (id) => this.viewGame(id),
      onViewFullGame: (id) => this.viewFullGame(id),
      onWinrateDetail: (id) => this.showWinrateDetail(id),
      onCardClick: (id) => this.onItemClick(id),
    });
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 预加载缩略图图片
    const { preloadThumbnailImages } = await import('../../components/JosekiThumbnail');
    await preloadThumbnailImages();
    const counts = this.filterManager.getCounts(this.patterns);
    this.tabs.setConfig({
      items: [
        { id: 'all', label: `全部 ${counts.all}` },
        { id: 'hot', label: `🔥热门 ${counts.hot}` },
        { id: 'hit', label: `🎯命中 ${counts.hit}` },
        { id: 'complex', label: `🧩复杂 ${counts.complex}` },
      ],
      activeId: 'all',
    });
    this.tabs.onChange((id: string) => this.setFilter(id as JosekiFilter));
    const clearReadBtn = document.getElementById('clear-read-btn');
    if (clearReadBtn) {
      clearReadBtn.addEventListener('click', () => this.clearReadMarks());
    }
    this.initialized = true;
  }
  async handleParams(params: PageParams): Promise<void> {
    const category = params['category'];
    const key = params['key'];
    this.readMarkManager.setCategory(category);
    if (category && key) {
      const provider = this.providers.get(category);
      if (provider) {
        try {
          const data = await provider.getJosekiPatterns(key);
          this.patterns = data.patterns;
          if (data.title) this._title = data.title;
        } catch (error) {
          console.error('从提供者加载定式数据失败', error as Error);
          this.patterns = [];
        }
      } else {
        console.warn(`未找到 category=${category} 的数据提供者`);
        this.patterns = [];
      }
    } else {
      console.warn('缺少 category 或 key 参数');
      this.patterns = [];
    }
    if (params['title']) this._title = params['title'];
    await this.readMarkManager.loadReadMarks();
    await this.initialize();
    this.render();
  }
  setData(patterns: IJosekiPattern[]): void {
    this.patterns = patterns;
    this.readMarkManager.loadReadMarks();
    this.render();
  }
  async clearReadMarks(): Promise<void> {
    await this.readMarkManager.clearReadMarks();
    this.toast.success('已读标记已清除');
    this.onClearReadMarks?.();
    this.render();
  }
  private setFilter(filter: JosekiFilter): void {
    this.filterManager.setFilter(filter);
    this.tabs.setActiveId(filter);
    this.render();
  }
  async onItemClick(patternId: string): Promise<void> {
    await this.readMarkManager.markRead(patternId);
    const pattern = this.patterns.find(p => p.id === patternId);
    const sgf = (pattern as any)?.sgf || pattern?.extractedMoves;
    if (sgf) {
      // 有棋谱数据，跳转到 replay 页面
      this.viewGame(patternId);
    } else {
      // 无棋谱数据，跳转到 explore 页面
      this.explorePattern(patternId);
    }
  }
  async showWinrateDetail(patternId: string): Promise<void> {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (!pattern?.winrateStats) {
      this.toast.info('无胜率数据');
      return;
    }
    this.winrateHelper.showWinrateDetail(pattern.winrateStats);
  }
  explorePattern(patternId: string): void {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (!pattern || !this.onNavigate) return;
    const movesParam = pattern.prefix.split(/\s+/).slice(0, pattern.prefixLen).join('-');
    this.onNavigate('joseki/explore', { moves: movesParam });
  }
  viewGame(patternId: string): void {
    const pattern = this.patterns.find(p => p.id === patternId);
    // 支持 sgf 和 extractedMoves 两个字段名
    const sgf = (pattern as any)?.sgf || pattern?.extractedMoves;
    if (!sgf || !pattern) {
      this.toast.warning('无棋谱数据');
      return;
    }
    if (this.onNavigate) {
      this.onNavigate('replay', { sgf, move: pattern.prefixLen.toString() });
    }
  }
  async viewFullGame(patternId: string): Promise<void> {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (!pattern?.gameInfo?.archiveId) {
      this.toast.warning('无棋谱归档ID');
      return;
    }
    if (this.onNavigate) {
      this.onNavigate('replay', { archiveId: pattern.gameInfo.archiveId });
    }
  }
  render(): void {
    this.renderer.render(this.patterns);
  }
  /**
   * 刷新已读标记（用于页面从缓存恢复时）
   */
  async refreshReadMarks(): Promise<void> {
    await this.readMarkManager.loadReadMarks();
    this.render();
  }
  destroy(): void {
    this.tabs.destroy();
    this.toast.destroy();
    this.patterns = [];
    this.readMarkManager.reset();
    this.initialized = false;
  }
}
