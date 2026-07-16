/** 详情页渲染器，完全照搬 events.html 的风格 */
import type { ICard, IToast, IAdapterFactory, IOverlay } from '../../../../core/interfaces';
import type { IEventFormatter } from './IEventFormatter';
import type { Group, AgainstPlanResult } from '../../../../../services/event/types';
import type { RankingResult } from '../../../../../domain/ranking';
import type { PlayerRanking } from '../../../../../domain/ranking/types';
import { GroupSelector } from '../../../../../domain/ranking/GroupSelector';
import { Select, type SelectInstance } from '@ui';
export interface EventDetailRendererCallbacks {
  onGroupChange: (groupId: string) => void;
  onTabChange: (tab: string) => void;
  onPrevRound: () => void;
  onNextRound: () => void;
  onPlayerClick: (playerName: string) => void;
  onShowOpponents: (playerName: string) => void;
  onRefresh?: () => Promise<void>;
}
export class EventDetailRenderer {
  readonly overlay: IOverlay;
  readonly toast: IToast;
  private rankingCard: ICard;
  private matchCard: ICard;
  private roundNav: ICard;
  // opponentCard 已移除，改为直接操作 DOM
  private activeTab: string = 'ranking';
  private groups: Group[] = [];
  private activeGroupId: string = '';
  private selectInstance?: SelectInstance | undefined;
  constructor(
    private readonly cb: EventDetailRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: IEventFormatter,
  ) {
    this.rankingCard = factory.createCard();
    this.matchCard = factory.createCard();
    this.roundNav = factory.createCard();
    this.overlay = factory.createOverlay();
    this.toast = factory.createToast();
  }
  initialize(): void {
    // 页面渲染时直接在这里渲染标签按钮
    this.renderTabs();
  }
  bindActions(): void {
    this.rankingCard.onAction((action, data) => {
      if (action === 'playerClick' && data?.['name']) this.cb.onPlayerClick(String(data['name']));
      if (action === 'showOpponents' && data?.['name']) this.cb.onShowOpponents(String(data['name']));
    });
    this.roundNav.onAction((action) => {
      if (action === 'prevRound') this.cb.onPrevRound();
      if (action === 'nextRound') this.cb.onNextRound();
    });
  }
  // 自绘分组选择和标签按钮
  renderTabs(): void {
    const container = document.getElementById('detail-tabs');
    if (!container) return;
    // 先销毁旧的 select 实例
    this.selectInstance?.destroy();
    container.innerHTML = '';
    // 先渲染分组选择
    if (this.groups.length > 0) {
      const selectWrapper = document.createElement('div');
      selectWrapper.style.cssText = 'display: inline-block; margin-right: 4px; max-width: 150px; vertical-align: middle;';
      const options = this.groups.map(g => ({
        value: String(g.id),
        label: g.players ? `${g.name} (${g.players}人)` : g.name,
      }));
      const currentValue = this.activeGroupId ? String(this.activeGroupId) : options[0]?.value || '';
      container.appendChild(selectWrapper);
      const instance = Select.mount(selectWrapper, {
        options,
        value: currentValue,
        onChange: (v) => this.cb.onGroupChange(v),
      });
      this.selectInstance = instance ?? undefined;
    }
    // 再渲染标签按钮
    const TABS = [
      { id: 'ranking', label: '📊 排名' },
      { id: 'matches', label: '⚔️ 对阵' },
    ];
    TABS.forEach(tab => {
      const btn = document.createElement('div');
      btn.className = 'detail-tab' + (tab.id === this.activeTab ? ' active' : '');
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.renderTabs();
        this.cb.onTabChange(tab.id);
      });
      container.appendChild(btn);
    });
    
    // 添加刷新按钮
    const refreshBtn = document.createElement('div');
    refreshBtn.className = 'detail-tab refresh-btn';
    refreshBtn.textContent = '🔄 刷新';
    refreshBtn.style.marginLeft = '2px';
    refreshBtn.addEventListener('click', async () => {
      if (this.cb.onRefresh) {
        refreshBtn.textContent = '🔄 刷新中...';
        refreshBtn.style.opacity = '0.6';
        try {
          await this.cb.onRefresh();
        } finally {
          // 刷新完成后恢复按钮状态
          refreshBtn.textContent = '🔄 刷新';
          refreshBtn.style.opacity = '1';
        }
      }
    });
    container.appendChild(refreshBtn);
  }
  renderGroupSelect(groups: Group[], defaultGroupId?: number): void {
    this.groups = GroupSelector.sortByPriority(groups);
    if (defaultGroupId) {
      this.activeGroupId = String(defaultGroupId);
    } else if (this.groups.length > 0 && this.groups[0]) {
      this.activeGroupId = String(this.groups[0].id);
    } else {
      this.activeGroupId = '';
    }
    this.renderTabs();
  }
  render(): void {
    this.rankingCard.render();
  }
  showProgress(percent: number, message: string): void {
    this.overlay.setContent(this.formatter.formatProgress(percent, message));
    this.overlay.render();
    this.overlay.show();
  }
  private hideOverlay(): void {
    this.overlay.hide();
  }
  showRankingTab(): void {
    this.rankingCard.setVisible(true);
    this.roundNav.setVisible(false);
    this.matchCard.setVisible(false);
  }
  showMatchesTab(): void {
    this.rankingCard.setVisible(false);
    this.roundNav.render();
    this.matchCard.render();
    this.roundNav.setVisible(true);
    this.matchCard.setVisible(true);
  }
  renderRanking(result: RankingResult): void {
    this.hideOverlay();
    this.rankingCard.setContent(
      (!result.rankings || result.rankings.length === 0)
        ? this.formatter.formatEmptyRanking()
        : this.formatter.formatRankingTable(result.rankings)
    );
    this.rankingCard.render();
    this.showRankingTab();
    // 显示容器
    this.showContainer();
  }
  renderMatches(data: AgainstPlanResult, scoreMap?: Map<string, number>): void {
    this.hideOverlay();
    this.roundNav.render();
    this.matchCard.setContent(
      (!data.rows || data.rows.length === 0)
        ? this.formatter.formatEmptyMatches()
        : data.rows.map((m) => this.formatter.formatMatchCard(m, undefined, scoreMap)).join('\n')
    );
    this.matchCard.render();
    // 确保轮次导航在对阵列表之前
    this.roundNav.ensureBefore?.(this.matchCard);
    this.showMatchesTab();
    // 显示容器
    this.showContainer();
  }
  renderRoundNav(current: number, total: number): void {
    this.roundNav.setContent(this.formatter.formatRoundNav(current, total));
    this.roundNav.render();
  }
  renderError(message: string): void {
    this.hideOverlay();
    this.rankingCard.setContent(this.formatter.formatLoadError(message));
    this.rankingCard.render();
    this.showRankingTab();
    // 显示容器（即使错误也要显示）
    this.showContainer();
  }
  showOpponentModal(playerName: string, games: PlayerRanking['games'], rankMap?: Map<string, { rank: number; score: number }>): void {
    const html = this.formatter.formatOpponentModal(playerName, games, rankMap);
    if (!html) return;
    // 不再使用 opponentCard，直接添加到 body
    let modalEl = document.getElementById('opponent-modal-container');
    if (modalEl) modalEl.remove();
    modalEl = document.createElement('div');
    modalEl.id = 'opponent-modal-container';
    modalEl.innerHTML = html;
    modalEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (target && (target as HTMLElement).dataset?.['action'] === 'closeModal') modalEl.remove();
    });
    document.body.appendChild(modalEl);
  }
  hideOpponentModal(): void {
    const modalEl = document.getElementById('opponent-modal-container');
    if (modalEl) modalEl.remove();
  }
  showContainer(): void {
    const container = document.querySelector('.event-detail-group');
    if (container) {
      container.classList.add('has-content');
    }
  }
  destroy(): void {
    this.overlay.destroy();
    this.rankingCard.destroy();
    this.matchCard.destroy();
    this.roundNav.destroy();
    this.toast.destroy();
  }
}
