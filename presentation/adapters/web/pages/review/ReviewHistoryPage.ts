/**
 * 复盘历史页面
 * @module presentation/pages/review/ReviewHistoryPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ICard, IDialog, IToast, PageParams } from '../../../../core/interfaces';
import type { ReviewApp, ReviewHistoryEntry } from '../../../../../application/review';
export interface ReviewHistoryPageConfig {
  reviewApp: ReviewApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class ReviewHistoryPage implements IPage {
  readonly title = '复盘历史';
  private reviewApp: ReviewApp;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private card: ICard;
  private dialog: IDialog;
  private toast: IToast;
  private history: ReviewHistoryEntry[] = [];
  constructor(config: ReviewHistoryPageConfig) {
    this.reviewApp = config.reviewApp;
    this.onNavigate = config.onNavigate;
    this.card = AdapterFactory.createCard();
    this.dialog = AdapterFactory.createDialog();
    this.toast = AdapterFactory.createToast();
  }
  async initialize(): Promise<void> {
    await this.loadHistory();
  }
  handleParams(_params: PageParams): void {}
  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.reviewApp.queryHistory({ limit: 20 });
      this.render();
    } catch (error) {
      console.error('加载历史失败', error as Error);
    }
  }
  async viewDetail(entryId: string): Promise<void> {
    const detail = await this.reviewApp.getHistoryDetail(entryId);
    if (!detail) {
      this.toast.warning('无法恢复复盘');
      return;
    }
    // 跳转到复盘页面（如果有 sgf）
    if (this.onNavigate && detail.data?.['sgf']) {
      this.onNavigate('review', { sgf: btoa(encodeURIComponent(detail.data['sgf'] as string)) });
    }
  }
  async clearHistory(): Promise<void> {
    const confirmed = await this.dialog.show({
      type: 'confirm', title: '清空历史', content: '确定要清空所有复盘记录吗？',
    });
    if (confirmed) {
      await this.reviewApp.clearHistory();
      this.history = [];
      this.toast.success('已清空');
      this.render();
    }
  }
  render(): void {
    if (this.history.length === 0) {
      this.card.setContent('暂无复盘记录');
    } else {
      const lines = this.history.map((entry, i) => {
        const date = new Date(entry.createdAt).toLocaleDateString();
        return `${i + 1}. ${entry.blackName} vs ${entry.whiteName}\n   ${entry.badMoveCount} 恶手 · ${entry.totalMoves} 手 · ${date}`;
      });
      this.card.setContent(`共 ${this.history.length} 条记录\n\n${lines.join('\n\n')}`);
    }
    this.card.render();
  }
  destroy(): void {
    this.card.destroy();
    this.dialog.destroy();
    this.toast.destroy();
  }
}