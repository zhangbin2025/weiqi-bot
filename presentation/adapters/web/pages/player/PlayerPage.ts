/**
 * 棋手查询页面控制器
 * @module presentation/pages/player/PlayerPage
 */
import type { IPage, IDialog, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { IPlayerQuerier, PlayerQueryResultWithBookmark, PlayerBookmark } from '../../../../../application/player';
import type { IPlayerFormatter } from './IPlayerFormatter';
import { PlayerRenderer } from './PlayerRenderer';
import { TaskHelper } from '../../../../../clients/web/shared/task-helper';
export type PlayerTab = 'query' | 'recent';
export interface PlayerPageConfig {
  playerQuerier: IPlayerQuerier;
  adapterFactory: IAdapterFactory;
  formatter: IPlayerFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class PlayerPage implements IPage {
  readonly title = '棋手查询';
  private playerQuerier: IPlayerQuerier;
  private dialog: IDialog;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private currentQuery?: string;
  private currentResult?: PlayerQueryResultWithBookmark | undefined;
  private initialized = false;
  private currentTab: PlayerTab = 'query';
  private favorites: PlayerBookmark[] = [];
  private renderer: PlayerRenderer;
  constructor(config: PlayerPageConfig) {
    this.playerQuerier = config.playerQuerier;
    this.onNavigate = config.onNavigate;
    this.dialog = config.adapterFactory.createDialog();
    this.renderer = new PlayerRenderer(
      {
        onSearch: (name) => this.searchPlayer(name),
        onTabChange: (tab) => this.switchTab(tab as PlayerTab),
        onClearHistory: () => this.clearFavorites(),
        onViewHistory: (name) => this.viewBookmark(name),
      },
      config.adapterFactory,
      config.formatter,
    );
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.renderer.initialize();
    this.renderer.bindActions();
    await this.loadFavorites();
    this.initialized = true;
  }
  handleParams(params: PageParams): void {
    if (params['player']) {
      this.currentQuery = params['player'];
      this.renderer.input.setValue(params['player']);
      this.searchPlayer(params['player']);
    }
    if (params['tab']) this.switchTab(params['tab'] as PlayerTab);
  }
  async switchTab(tabName: PlayerTab): Promise<void> {
    this.currentTab = tabName;
    if (tabName === 'recent') {
      await this.loadFavorites();
      this.renderer.renderHistory(this.favorites);
    }
  }
  private async loadFavorites(): Promise<void> {
    try {
      this.favorites = await this.playerQuerier.getFavorites();
    } catch {
      this.favorites = [];
    }
  }
  async clearFavorites(): Promise<void> {
    await this.playerQuerier.clearFavorites();
    this.favorites = [];
    this.renderer.renderHistory([]);
    this.renderer.toast.success('收藏已清除');
  }
  viewBookmark(name: string): void {
    this.currentTab = 'query';
    this.renderer.tabs.setActiveId('query');
    this.renderer.queryPanel.setVisible(true);
    this.renderer.recentPanel.setVisible(false);
    this.renderer.input.setValue(name);
    const bookmark = this.favorites.find((e) => e.name === name);
    if (bookmark?.result) {
      this.currentQuery = name;
      this.currentResult = { ...bookmark.result };
      this.renderer.renderResult(this.currentResult);
    } else {
      this.searchPlayer(name);
    }
  }
  
  /**
   * 执行查询（支持后台任务）
   */
  async executeQuery(name: string, taskId?: string): Promise<void> {
    this.currentQuery = name;
    this.currentResult = undefined;
    this.renderer.showLoading(name);
    
    try {
      const result = await this.playerQuerier.query(name);
      this.currentResult = result;
      
      const found = (result.shoutan.found && result.shoutan.players.length > 0)
        || (result.yichafen.found && result.yichafen.data);
      
      if (!found) {
        this.renderer.toast.info(`未找到棋手: ${name}`);
        this.renderer.renderResult(result);
        
        // 后台任务完成（未找到）
        TaskHelper.notifyComplete(taskId, '查询完成', `未找到棋手: ${name}`, '');
      } else {
        this.renderer.renderResult(result);
        
        // 后台任务完成（找到棋手）
        if (taskId) {
          const detailUrl = `/assistant?taskId=${taskId}`;
          
          // 构造简洁消息
          const parts: string[] = [`找到棋手: ${name}`];
          
          if (result.shoutan.found && result.shoutan.players.length > 0) {
            const player = result.shoutan.players[0];
            const info: string[] = [];
            if (player!.title) info.push(player!.title);
            if (player!.rank) info.push(`排名${player!.rank}`);
            if (player!.rating) parts.push(`📊 ${player!.rating}`);
            if (info.length > 0) parts.push(info.join(' · '));
          }
          
          if (result.yichafen.found && result.yichafen.data?.level) {
            parts.push(`🏆 ${result.yichafen.data.level}`);
          }
          
          const message = parts.join(' ') + `\n\n[查看详情](/player/index.html?player=${encodeURIComponent(name)})`;
          
          TaskHelper.notifyComplete(taskId, '查询完成', message, detailUrl);
        }
      }
    } catch (error) {
      this.renderer.toast.error(`查询失败: ${error instanceof Error ? error.message : '未知错误'}`);
      
      // 后台任务失败
      TaskHelper.notifyFail(taskId, error instanceof Error ? error.message : '未知错误');
    } finally {
      this.renderer.hideLoading();
    }
  }
  private async searchPlayer(name: string): Promise<void> {
    this.currentQuery = name;
    this.currentResult = undefined;
    this.renderer.showLoading(name);
    
    try {
      const result = await this.playerQuerier.query(name);
      this.currentResult = result;
      
      const found = (result.shoutan.found && result.shoutan.players.length > 0)
        || (result.yichafen.found && result.yichafen.data);
      
      if (!found) {
        this.renderer.toast.info(`未找到棋手: ${name}`);
      }
      
      this.renderer.renderResult(result);
    } catch (error) {
      this.renderer.toast.error(`查询失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      this.renderer.hideLoading();
    }
  }
  render(): void { this.renderer.render(); }
  destroy(): void {
    this.renderer.destroy();
    this.dialog.destroy();
    this.currentResult = undefined;
    this.favorites = [];
    this.initialized = false;
  }
}
