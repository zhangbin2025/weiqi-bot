/**
 * 调试页面逻辑
 * @module presentation/adapters/web/pages/debug/DebugPage
 */
import type { IDebugService } from '@services/debug/IDebugService';
import { DebugRenderer } from './DebugRenderer';
/**
 * 调试页面配置
 */
export interface DebugPageConfig {
  debugService: IDebugService;
  logger: { 
    info: (msg: string) => void; 
    error: (msg: string) => void 
  };
}
/**
 * 调试页面
 */
export class DebugPage {
  private renderer: DebugRenderer;
  private currentTab: 'logs' | 'storage' | 'performance' | 'sniffer' = 'logs';
  constructor(private config: DebugPageConfig) {
    this.renderer = new DebugRenderer();
  }
  /**
   * 初始化页面
   */
  async initialize() {
    await this.loadAppInfo();
    this.bindEvents();
  }
  /**
   * 渲染页面
   */
  render() {
    this.renderer.renderShell();
    this.switchTab('logs');
  }
  /**
   * 加载 App 信息
   */
  private async loadAppInfo() {
    const appInfo = await this.config.debugService.getAppInfo();
    this.renderer.renderAppInfo(appInfo);
  }
  /**
   * 绑定事件
   */
  private bindEvents() {
    // Tab 切换事件
    document.querySelectorAll('.debug-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const tabName = target.dataset['tab'] as any;
        this.switchTab(tabName);
      });
    });
  }
  /**
   * 切换 Tab
   */
  private async switchTab(tab: 'logs' | 'storage' | 'performance' | 'sniffer') {
    this.currentTab = tab;
    // 更新 Tab 状态
    document.querySelectorAll('.debug-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
    // 加载内容
    switch (tab) {
      case 'logs':
        await this.loadLogs();
        break;
      case 'storage':
        await this.loadStorage();
        break;
      case 'performance':
        await this.loadPerformance();
        break;
      case 'sniffer':
        // 抓包功能已废弃
        break;
    }
  }
  /**
   * 加载日志
   */
  private async loadLogs() {
    const logs = await this.config.debugService.getLogs({ limit: 100 });
    const stats = await this.config.debugService.getLogStats();
    this.renderer.renderLogs(logs, stats);
    // 绑定清空日志按钮
    document.getElementById('clear-logs')?.addEventListener('click', async () => {
      await this.config.debugService.clearLogs();
      await this.loadLogs();
    });
  }
  /**
   * 加载存储
   */
  private async loadStorage() {
    const stats = await this.config.debugService.getStorageStats();
    this.renderer.renderStorage(stats);
    // 绑定清空缓存按钮
    document.getElementById('clear-cache')?.addEventListener('click', async () => {
      await this.config.debugService.clearCache();
      await this.loadStorage();
    });
  }
  /**
   * 加载性能
   */
  private async loadPerformance() {
    const memory = await this.config.debugService.getMemoryInfo();
    this.renderer.renderPerformance(memory);
  }
  /**
   * 加载抓包
   */
  private async loadSniffer() {
    // 抓包功能已废弃
    console.log('Sniffer feature has been deprecated');
  }
}
