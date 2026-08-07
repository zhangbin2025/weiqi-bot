/**
 * 决策题导航页
 * @module presentation/pages/decision/DecisionIndexPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ITabs, ICard, IButton, IProgress, PageParams } from '../../../../core/interfaces';
import type { DecisionApp } from '../../../../../application/decision';
type DecisionTab = 'online' | 'upload' | 'history';
export interface DecisionIndexPageConfig {
  decisionApp: DecisionApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class DecisionIndexPage implements IPage {
  readonly title = '决策做题';
  private decisionApp: DecisionApp;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private tabs: ITabs;
  private card: ICard;
  private progress: IProgress;
  private generateBtn: IButton;
  private currentTab: DecisionTab = 'online';
  private currentResult?: { problems: unknown[] };
  // 线上棋谱配置
  private dateOffset: number = 1; // 昨天
  private limit: number = 20;
  private initialized = false;
  constructor(config: DecisionIndexPageConfig) {
    this.decisionApp = config.decisionApp;
    this.onNavigate = config.onNavigate;
    this.tabs = AdapterFactory.createTabs();
    this.card = AdapterFactory.createCard();
    this.progress = AdapterFactory.createProgress();
    this.generateBtn = AdapterFactory.createButton();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.tabs.setConfig({
      items: [
        { id: 'online', label: '🌐 线上棋谱' },
        { id: 'upload', label: '📁 导入棋谱' },
        { id: 'history', label: '📋 历史' },
      ],
      activeId: 'online',
    });
    this.tabs.onChange((id) => this.switchTab(id as DecisionTab));
    this.generateBtn.setText('生成决策题');
    this.generateBtn.onClick(() => this.generate());
    this.initialized = true;
  }
  handleParams(_params: PageParams): void {}
  private async generate(): Promise<void> {
    this.generateBtn.setDisabled(true);
    this.generateBtn.setLoading(true);
    this.progress.show();
    try {
      const date = this.dateOffset ? this.getDateStr(this.dateOffset) : undefined;
      const limitNum = this.limit;
      this.progress.setValue(20);
      const result = await this.decisionApp.generateFromOnlineWithOptions(date, limitNum);
      this.progress.setValue(100);
      this.currentResult = result;
      setTimeout(() => {
        this.progress.hide();
        this.startQuiz();
      }, 500);
    } catch (error) {
      console.error('生成决策题失败', error as Error);
      this.progress.hide();
    } finally {
      this.generateBtn.setDisabled(false);
      this.generateBtn.setLoading(false);
    }
  }
  private startQuiz(): void {
    if (this.currentResult && this.onNavigate) {
      this.onNavigate('decision/quiz', {
        problemsJson: JSON.stringify(this.currentResult.problems),
      });
    }
  }
  private switchTab(tab: DecisionTab): void {
    this.currentTab = tab;
    if (tab === 'history' && this.onNavigate) {
      this.onNavigate('decision/history');
    }
    this.render();
  }
  private getDateStr(offset: number): string {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date.toISOString().slice(0, 10);
  }
  render(): void {
    this.tabs.render();
    if (this.currentTab === 'online') {
      const dateLabel = this.dateOffset === 0 ? '今天' : this.dateOffset === 1 ? '昨天' : '全部';
      this.card.setContent([
        '决策做题',
        '',
        `来源: 野狐围棋`,
        `日期: ${dateLabel}`,
        `数量: ${this.limit} 个棋谱`,
        '',
        '从野狐公开棋谱生成实战决策题',
        '分析恶手并找出最佳着法',
      ].join('\n'));
      this.card.render();
      this.generateBtn.render();
    } else if (this.currentTab === 'upload') {
      this.card.setContent([
        '导入 SGF 文件',
        '',
        '选择本地棋谱文件进行分析',
        '',
        '⚠️ 此功能需要文件上传支持',
      ].join('\n'));
      this.card.render();
    }
    this.progress.render();
  }
  destroy(): void {
    this.tabs.destroy();
    this.card.destroy();
    this.progress.destroy();
    this.generateBtn.destroy();
    this.initialized = false;
  }
}
