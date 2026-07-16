/**
 * PlayerPage 渲染器
 * @description 通过 ICard/IInput/ITabs/IPanel/IButton 接口管理布局和渲染
 * @module presentation/pages/player/PlayerRenderer
 */
import type { ICard, IInput, IButton, ITabs, IPanel, IToast, IAdapterFactory } from '../../../../core/interfaces';
import type { IPlayerFormatter } from './IPlayerFormatter';
import type { PlayerQueryResultWithBookmark, PlayerBookmark } from '../../../../../application/player';
export interface RendererCallbacks {
  onSearch: (name: string) => void;
  onTabChange: (tab: string) => void;
  onClearHistory: () => void;
  onViewHistory: (name: string) => void;
}
export class PlayerRenderer {
  readonly tabs: ITabs;
  readonly queryPanel: IPanel;
  readonly recentPanel: IPanel;
  readonly input: IInput;
  readonly searchBtn: IButton;
  readonly historyCard: ICard;
  readonly resultCard: ICard;
  readonly toast: IToast;
  private hasResult = false;
  constructor(
    private readonly cb: RendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: IPlayerFormatter,
  ) {
    this.tabs = factory.createTabs();
    this.queryPanel = factory.createPanel();
    this.recentPanel = factory.createPanel();
    const qc = this.queryPanel.asContainer();
    this.input = factory.createInput(qc);
    this.searchBtn = factory.createButton(qc);
    const rc = this.recentPanel.asContainer();
    this.historyCard = factory.createCard(rc);
    this.resultCard = factory.createCard();
    this.toast = factory.createToast();
  }
  initialize(): void {
    this.tabs.setConfig({
      items: [
        { id: 'query', label: '🔍 查询' },
        { id: 'recent', label: '⭐ 收藏' },
      ],
      activeId: 'query',
    });
    this.tabs.onChange((id) => {
      this.queryPanel.setVisible(id === 'query');
      this.recentPanel.setVisible(id === 'recent');
      if (id === 'recent') {
        this.resultCard.setVisible(false);
      } else if (this.hasResult) {
        this.resultCard.setVisible(true);
      }
      this.cb.onTabChange(id);
    });
    this.queryPanel.setTitle('🔍 棋手姓名');
    this.input.setConfig({ placeholder: '请输入棋手姓名...', maxLength: 20 });
    this.input.onEnter((t) => { if (t.trim()) this.cb.onSearch(t.trim()); });
    this.searchBtn.setText('开始查询');
    this.searchBtn.onClick(() => {
      const v = this.input.getValue();
      if (v.trim()) this.cb.onSearch(v.trim());
    });
    this.recentPanel.setTitle('⭐ 我的收藏');
    if (this.recentPanel.addAction) {
      this.recentPanel.addAction('🗑️ 清除', 'clearBookmarks');
    }
    this.recentPanel.onAction((action) => {
      if (action === 'clearBookmarks') this.cb.onClearHistory();
    });
    this.recentPanel.setVisible(false);
    this.resultCard.setVisible(false);
  }
  bindActions(): void {
    this.historyCard.onAction((action, data) => {
      if (action === 'viewHistory' && data?.['name']) {
        this.cb.onViewHistory(data['name']);
      }
    });
  }
  showLoading(name: string): void {
    this.searchBtn.setLoading(true);
    this.input.setDisabled(true);
    this.resultCard.setContent(this.formatter.formatLoading(name));
    this.resultCard.setVisible(true);
    this.resultCard.render();
  }
  hideLoading(): void {
    this.searchBtn.setLoading(false);
    this.searchBtn.setText('开始查询');
    this.input.setDisabled(false);
  }
  renderResult(result: PlayerQueryResultWithBookmark): void {
    this.hasResult = true;
    this.resultCard.setTitle('♟ 查询结果');
    this.resultCard.setContent(this.formatter.formatResult(result));
    this.resultCard.setVisible(true);
    this.resultCard.render();
  }
  renderHistory(history: PlayerBookmark[]): void {
    if (history.length === 0) {
      this.historyCard.setContent(this.formatter.formatEmptyBookmarks());
      return;
    }
    const items = history.slice(0, 10).map((e) => this.formatter.formatBookmarkItem(e));
    this.historyCard.setContent(items.join('\n'));
  }
  render(): void {
    this.tabs.render();
    this.queryPanel.render();
    this.recentPanel.render();
    this.resultCard.render();
  }
  destroy(): void {
    this.tabs.destroy();
    this.queryPanel.destroy();
    this.recentPanel.destroy();
    this.resultCard.destroy();
    this.toast.destroy();
  }
}
