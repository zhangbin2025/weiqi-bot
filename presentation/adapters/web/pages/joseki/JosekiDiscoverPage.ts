/**
 * 定式发现页面
 * @module presentation/adapters/web/pages/joseki/JosekiDiscoverPage
 */
import type { IPage, IToast, PageParams } from '../../../../core/interfaces';
import type { JosekiDiscoverApp, DiscoverResult } from '../../../../../application/joseki';
import { DiscoverHistoryManager } from './discover/DiscoverHistoryManager';
import { DiscoverUIHelper } from './discover/DiscoverUIHelper';
import { Dialog, Select } from '@ui';
import { TaskHelper } from '../../../../../clients/web/shared/task-helper';
type DiscoverTab = 'online' | 'upload' | 'history';
export interface JosekiDiscoverPageConfig {
  discoverApp: JosekiDiscoverApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class JosekiDiscoverPage implements IPage {
  readonly title = '定式发现';
  private discoverApp: JosekiDiscoverApp;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private currentTab: DiscoverTab = 'online';
  private initialized = false;
  private analyzing = false;
  private currentResult: DiscoverResult | undefined;
  private currentGames: Array<{ title: string; date: string; archiveId?: string }> = [];
  // 子模块
  private historyManager: DiscoverHistoryManager;
  private uiHelper: DiscoverUIHelper;
  constructor(config: JosekiDiscoverPageConfig) {
    this.discoverApp = config.discoverApp;
    this.onNavigate = config.onNavigate;
    // 创建子模块
    this.uiHelper = new DiscoverUIHelper();
    this.historyManager = new DiscoverHistoryManager({
      discoverApp: config.discoverApp,
      onLoadResult: (result, source) => this.loadHistoryResult(result, source),
      formatDate: (ts) => this.uiHelper.formatDate(ts),
    });
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.bindEvents();
    await this.historyManager.loadHistory();
    this.initialized = true;
  }
  private bindEvents(): void {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabId = (tab as HTMLElement).dataset['tab'];
        if (tabId) this.switchTab(tabId as DiscoverTab);
      });
    });
    document.getElementById('analyze-btn')?.addEventListener('click', () => this.startOnlineAnalysis());
    const fileInput = document.getElementById('sgf-file-input') as HTMLInputElement;
    fileInput?.addEventListener('change', (e) => this.handleFileSelect(e));
    document.getElementById('upload-btn')?.addEventListener('click', () => this.startUploadAnalysis());
    document.getElementById('clear-btn')?.addEventListener('click', () => this.clearHistory());
    document.getElementById('stats-card')?.addEventListener('click', () => this.viewJoseki());
  }
  handleParams(params: PageParams): void {
    if (params['tab']) this.switchTab(params['tab'] as DiscoverTab);
  }
  private switchTab(tab: DiscoverTab): void {
    this.currentTab = tab;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', (t as HTMLElement).dataset['tab'] === tab);
    });
    const onlineTab = document.getElementById('online-tab');
    const uploadTab = document.getElementById('upload-tab');
    const historyTab = document.getElementById('history-tab');
    if (onlineTab) onlineTab.style.display = tab === 'online' ? 'block' : 'none';
    if (uploadTab) uploadTab.style.display = tab === 'upload' ? 'block' : 'none';
    if (historyTab) historyTab.style.display = tab === 'history' ? 'block' : 'none';
    this.uiHelper.showStatsSection(false);
    if (tab === 'history') {
      this.historyManager.renderHistoryList();
    }
  }
  private async startOnlineAnalysis(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    const btn = document.getElementById('analyze-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '分析中...';
    }
    try {
      const dateSelect = Select.get('#date-select');
      const limitSelect = Select.get('#limit-select');
      const dateOffset = dateSelect ? parseInt(dateSelect.getValue()) : 7; // 默认 7 天
      const limit = limitSelect ? parseInt(limitSelect.getValue()) : 50;
      const date = this.uiHelper.getDateStr(dateOffset);
      this.uiHelper.showProgress(true);
      this.uiHelper.updateProgress(0, '正在获取棋谱列表...');
      this.currentResult = await this.discoverApp.discoverFromOnline(
        'foxwq',
        date,
        limit,
        (percent, status) => this.uiHelper.updateProgress(percent, status)
      );
      this.currentGames = this.currentResult.games.map(g => ({
        title: `${g.black} vs ${g.white}`,
        date: g.date || '',
        archiveId: g.archiveId || ''
      }));
      this.uiHelper.updateProgress(100, `分析完成，发现 ${this.currentResult.totalPatterns} 个定式`);
      await this.historyManager.loadHistory();
      setTimeout(() => {
        this.uiHelper.showProgress(false);
        this.displayStats();
      }, 500);
    } catch (error) {
      console.error('线上棋谱分析失败', error as Error);
      this.uiHelper.updateProgress(100, '分析失败: ' + (error as Error).message);
      setTimeout(() => this.uiHelper.showProgress(false), 2000);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '开始分析';
    }
    this.analyzing = false;
  }
  private handleFileSelect(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    const fileNameEl = document.getElementById('file-name');
    const uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement;
    if (file) {
      if (fileNameEl) fileNameEl.textContent = file.name;
      if (uploadBtn) uploadBtn.disabled = false;
    } else {
      if (fileNameEl) fileNameEl.textContent = '';
      if (uploadBtn) uploadBtn.disabled = true;
    }
  }
  private async startUploadAnalysis(): Promise<void> {
    const fileInput = document.getElementById('sgf-file-input') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) {
      await Dialog.alert('请选择 SGF 文件');
      return;
    }
    if (this.analyzing) return;
    this.analyzing = true;
    const btn = document.getElementById('upload-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '分析中...';
    }
    try {
      this.uiHelper.showProgress(true);
      this.uiHelper.updateProgress(0, '正在读取文件...');
      const sgfContent = await this.readFileAsText(file);
      const fileName = file.name.replace(/\.sgf$/i, '');
      this.uiHelper.updateProgress(30, '正在分析棋谱...');
      this.currentResult = await this.discoverApp.discoverFromSGF(
        sgfContent,
        fileName,
        (percent, status) => this.uiHelper.updateProgress(30 + percent * 0.7, status)
      );
      this.currentGames = this.currentResult.games.map(g => ({
        title: `${g.black} vs ${g.white}`,
        date: g.date || '',
        archiveId: g.archiveId || ''
      }));
      this.uiHelper.updateProgress(100, `分析完成，发现 ${this.currentResult.totalPatterns} 个定式`);
      await this.historyManager.loadHistory();
      setTimeout(() => {
        this.uiHelper.showProgress(false);
        this.displayStats();
      }, 500);
    } catch (error) {
      console.error('导入棋谱分析失败', error as Error);
      this.uiHelper.updateProgress(100, '分析失败: ' + (error as Error).message);
      setTimeout(() => this.uiHelper.showProgress(false), 2000);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '开始分析';
    }
    this.analyzing = false;
  }
  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'UTF-8');
    });
  }
  private displayStats(): void {
    this.uiHelper.hideAllTabs();
    this.uiHelper.displayStats(this.currentResult);
    this.uiHelper.showStatsSection(true);
  }
  private viewJoseki(): void {
    if (!this.currentResult || this.currentResult.patterns.length === 0) {
      void Dialog.alert('无定式数据');
      return;
    }
    // 如果有 onNavigate，使用它跳转
    if (this.onNavigate) {
      const params: Record<string, string> = {
        source: 'discover',
        title: '发现结果',
      };
      // 如果有 category 和 key，添加到参数中
      if (this.currentResult['category']) {
        params['category'] = this.currentResult['category'];
      }
      if (this.currentResult['key']) {
        params['key'] = this.currentResult['key'];
      }
      this.onNavigate('joseki/list', params);
    } else if (this.currentResult['category'] && this.currentResult['key']) {
      // 如果没有 onNavigate，但有 category 和 key，使用 window.location.href
      window.location.href = `list.html?category=${encodeURIComponent(this.currentResult['category'])}&key=${encodeURIComponent(this.currentResult['key'])}`;
    } else {
      void Dialog.alert('无法跳转，请重新分析');
    }
  }
  private loadHistoryResult(result: DiscoverResult, source: string): void {
    this.currentResult = result;
    this.currentGames = result.games?.map(g => ({
      title: `${g.black} vs ${g.white}`,
      date: g.date || '',
      archiveId: g.archiveId || ''
    })) || [];
    const tabName = source === 'upload' ? 'upload' : 'online';
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', (tab as HTMLElement).dataset['tab'] === tabName);
    });
    this.displayStats();
  }
  private async clearHistory(): Promise<void> {
    await this.historyManager.clearHistory();
    await Dialog.alert('历史记录已清除');
  }
  
  /**
   * 执行定式发现（支持后台任务）
   */
  async executeDiscover(dateOffset: number, limit: number, taskId?: string): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    
    try {
      const date = this.uiHelper.getDateStr(dateOffset);
      this.uiHelper.showProgress(true);
      this.uiHelper.updateProgress(0, '正在获取棋谱列表...');
      
      this.currentResult = await this.discoverApp.discoverFromOnline(
        'foxwq',
        date,
        limit,
        (percent, status) => {
          this.uiHelper.updateProgress(percent, status);
          // 后台任务进度通知
          TaskHelper.notifyProgress(taskId, percent, status);
        }
      );
      
      this.currentGames = this.currentResult.games.map(g => ({
        title: `${g.black} vs ${g.white}`,
        date: g.date || '',
        archiveId: g.archiveId || ''
      }));
      
      this.uiHelper.updateProgress(100, `分析完成，发现 ${this.currentResult.totalPatterns} 个定式`);
      await this.historyManager.loadHistory();
      
      setTimeout(() => {
        this.uiHelper.showProgress(false);
        this.displayStats();
      }, 500);
      
      // 后台任务完成通知
      if (taskId) {
        const message = `📋 ${this.currentResult.gamesCount}局 🎯 ${this.currentResult.totalPatterns}定式\n\n[查看详情](/joseki/discover.html?view=favorite&key=${encodeURIComponent(this.currentResult.key || '')})`;
        TaskHelper.notifyComplete(
          taskId,
          '定式发现',
          message,
          `/assistant?taskId=${taskId}`
        );
      }
    } catch (error) {
      console.error('[JosekiDiscoverPage] 定式发现失败', error as Error);
      this.uiHelper.updateProgress(100, '分析失败: ' + (error as Error).message);
      setTimeout(() => this.uiHelper.showProgress(false), 2000);
      
      // 后台任务失败通知
      TaskHelper.notifyFail(taskId, (error as Error).message || '未知错误');
    }
    
    this.analyzing = false;
  }
  
  /**
   * 查看收藏结果
   */
  async viewFavorite(key: string): Promise<void> {
    try {
      // 从收藏服务加载结果
      const entry = await this.discoverApp.getHistoryDetail(key);
      
      if (!entry) {
        await Dialog.alert('收藏数据不存在');
        return;
      }
      
      // 构造 DiscoverResult
      const result: DiscoverResult = {
        patterns: entry.patterns || [],
        games: entry.games || [],
        gamesCount: entry.gamesCount || 0,
        totalPatterns: entry.patternsFound || 0,
        category: entry.category,
        key: entry.key,
      };
      
      // 加载收藏结果
      this.loadHistoryResult(result, entry.source || 'online');
    } catch (error) {
      console.error('[JosekiDiscoverPage] 查看收藏失败', error as Error);
      await Dialog.alert('加载收藏失败: ' + (error as Error).message);
    }
  }
  
  render(): void {}
  destroy(): void {
    this.currentResult = undefined;
    this.currentGames = [];
    this.initialized = false;
  }
}
