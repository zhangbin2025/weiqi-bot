/**
 * 对弈历史页面
 * @module presentation/pages/play/PlayHistoryPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ICard, IDialog, IToast, PageParams } from '../../../../core/interfaces';
import type { HMPlayApp, HHPlayApp, MMPlayApp, PlayHistoryEntry } from '../../../../../application/play';
export interface PlayHistoryPageConfig {
  hmPlayApp?: HMPlayApp;
  hhPlayApp?: HHPlayApp;
  mmPlayApp?: MMPlayApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class PlayHistoryPage implements IPage {
  readonly title = '历史对局';
  private hmPlayApp?: HMPlayApp | undefined;
  private hhPlayApp?: HHPlayApp | undefined;
  private mmPlayApp?: MMPlayApp | undefined;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private card: ICard;
  private dialog: IDialog;
  private toast: IToast;
  private history: PlayHistoryEntry[] = [];
  private initialized = false;
  constructor(config: PlayHistoryPageConfig) {
    this.hmPlayApp = config.hmPlayApp;
    this.hhPlayApp = config.hhPlayApp;
    this.mmPlayApp = config.mmPlayApp;
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
    const allHistory: PlayHistoryEntry[] = [];
    try {
      const hmHistory = this.hmPlayApp ? await this.hmPlayApp.queryHistory({ limit: 20 }) : [];
      const hhHistory = this.hhPlayApp ? await this.hhPlayApp.queryHistory({ limit: 20 }) : [];
      const mmHistory = this.mmPlayApp ? await this.mmPlayApp.queryHistory({ limit: 20 }) : [];
      allHistory.push(...hmHistory);
      allHistory.push(...hhHistory);
      allHistory.push(...mmHistory);
      this.history = allHistory
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, 50);
      this.render();
    } catch (error) {
      console.error('加载历史失败', error as Error);
      this.toast.error('加载历史失败');
    }
  }
  async clearHistory(): Promise<void> {
    const confirmed = await this.dialog.show({
      type: 'confirm',
      title: '清空历史',
      content: '确定要清空所有历史对局吗？',
    });
    if (confirmed) {
      try {
        await this.hmPlayApp?.clearHistory();
        await this.hhPlayApp?.clearHistory();
        await this.mmPlayApp?.clearHistory();
        this.history = [];
        this.toast.success('已清空');
        this.render();
      } catch (error) {
        console.error('清空历史失败', error as Error);
        this.toast.error('清空失败');
      }
    }
  }
  async viewGame(entryId: string): Promise<void> {
    const entry = this.history.find(h => h.id === entryId);
    if (!entry) {
      this.toast.warning('找不到该对局');
      return;
    }
    if (this.onNavigate) {
      this.onNavigate('replay', { id: entryId });
    }
  }
  render(): void {
    if (this.history.length === 0) {
      this.card.setContent('暂无历史对局\n\n开始新对局后，历史记录将保存在这里');
      this.card.render();
      return;
    }
    const lines = this.history.map((game) => {
      const date = new Date(game.playedAt).toLocaleDateString();
      const resultText = game.result || '未完成';
      return `${game.blackName} vs ${game.whiteName}\n   ${date} · ${game.moveCount}手 · ${resultText}`;
    });
    this.card.setContent(`共 ${this.history.length} 局\n\n${lines.join('\n\n')}`);
    this.card.render();
  }
  destroy(): void {
    this.card.destroy();
    this.dialog.destroy();
    this.toast.destroy();
    this.initialized = false;
  }
}