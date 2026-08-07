/**
 * 决策题历史页面
 * @module presentation/pages/decision/DecisionHistoryPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ICard, IDialog, IToast, PageParams } from '../../../../core/interfaces';
import type { DecisionApp, DecisionHistoryEntry } from '../../../../../application/decision';
export interface DecisionHistoryPageConfig {
  decisionApp: DecisionApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class DecisionHistoryPage implements IPage {
  readonly title = '生成历史';
  private decisionApp: DecisionApp;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private card: ICard;
  private dialog: IDialog;
  private toast: IToast;
  private history: DecisionHistoryEntry[] = [];
  private initialized = false;
  constructor(config: DecisionHistoryPageConfig) {
    this.decisionApp = config.decisionApp;
    this.onNavigate = config.onNavigate;
    this.card = AdapterFactory.createCard();
    this.dialog = AdapterFactory.createDialog();
    this.toast = AdapterFactory.createToast();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadHistory();
    this.initialized = true;
  }
  handleParams(_params: PageParams): void {}
  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.decisionApp.queryHistory({ limit: 20 });
      this.render();
    } catch (error) {
      console.error('加载历史失败', error as Error);
    }
  }
  async continueQuiz(entryId: string): Promise<void> {
    const entry = this.history.find(h => h.id === entryId);
    if (!entry) return;
    const detail = await this.decisionApp.getHistoryDetail(entryId);
    if (!detail?.problems) {
      this.toast.warning('无法恢复题目');
      return;
    }
    if (this.onNavigate) {
      this.onNavigate('decision/quiz', {
        problemsJson: JSON.stringify(detail.problems),
      });
    }
  }
  async clearHistory(): Promise<void> {
    const confirmed = await this.dialog.show({
      type: 'confirm',
      title: '清空历史',
      content: '确定要清空所有生成记录吗？',
    });
    if (confirmed) {
      await this.decisionApp.clearHistory();
      this.history = [];
      this.toast.success('已清空');
      this.render();
    }
  }
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  }
  render(): void {
    if (this.history.length === 0) {
      this.card.setContent('暂无生成记录');
    } else {
      const lines = this.history.map((entry, i) => {
        return `${i + 1}. ${entry.label}\n   ${entry.problemsCount} 题 · ${this.formatDate(entry.generatedAt)}`;
      });
      this.card.setContent(`共 ${this.history.length} 条记录\n\n${lines.join('\n\n')}`);
    }
    this.card.render();
  }
  destroy(): void {
    this.card.destroy();
    this.dialog.destroy();
    this.toast.destroy();
    this.initialized = false;
  }
}
