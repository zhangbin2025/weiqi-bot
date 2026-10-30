/**
 * 详情页渲染器，完全照搬 events.html 的风格
 */
import type { ICard, IToast, IAdapterFactory, IOverlay } from '../../../../core/interfaces';
import type { IEventFormatter } from './IEventFormatter';
import type { Group, Player, PlayerListResult, AgainstPlanResult } from '../../../../../services/event/types';
import type { RankingResult } from '../../../../../domain/ranking';
import type { PlayerRanking, RankingMode } from '../../../../../domain/ranking/types';
import { GroupSelector } from '../../../../../domain/ranking/GroupSelector';
import { SessionStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/SessionStorageAdapter';
import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { Select, type SelectInstance } from '@ui';
/**
 * 取棋手的展示名，需与 HtmlEventFormatter 里排名表行 id 用的规则一致，
 * 否则 highlightRow 的 getElementById('rank-row-'+name) 命中不了。
 */
function cleanPlayerName(name: string): string {
  if (!name) return '';
  const m = name.match(/[\u4e00-\u9fa5]{2,4}/);
  return m ? m[0] : name.replace(/\|[\d\w:_-]+$/, '').trim();
}

export interface EventDetailRendererCallbacks {
  onGroupChange: (groupId: string) => void;
  onTabChange: (tab: string) => void;
  onPrevRound: () => void;
  onNextRound: () => void;
  onPlayerClick: (playerName: string) => void;
  onShowOpponents: (playerName: string) => void;
  onRankingModeChange: (mode: RankingMode) => void;
  onRefresh?: () => Promise<void>;
}
export class EventDetailRenderer {
  readonly overlay: IOverlay;
  readonly toast: IToast;
  private rankingCard: ICard;
  private matchCard: ICard;
  private playerCard: ICard;
  private roundNav: ICard;
  // opponentCard 已移除，改为直接操作 DOM
  private activeTab: string = 'ranking';
  /** 「参赛名单」标签是否可用：仅当该分组没有对阵表时显示 */
  private playersTabAvailable: boolean = false;
  /** 参赛名单数据 */
  private playerData: PlayerListResult | null = null;
  private groups: Group[] = [];
  private activeGroupId: string = '';
  private highlightedPlayerName: string = '';
  private rankingMode: RankingMode = 'default';
  /** 待恢复的弹窗状态：棋手名（原始名）+ 上次查看的对手名（干净名） */
  private pendingOpponent: { host: string; opponent: string } | null = null;
  /** 内容渲染完成的一次性回调（供弹窗恢复等待数据就绪） */
  private contentReadyOnce: Array<() => void> = [];
  private readonly sessionStore = new SessionStorageAdapter('weiqi-bot');
  private readonly localStore = new LocalStorageAdapter('weiqi-bot');
  private selectInstance?: SelectInstance | undefined;
  constructor(
    private readonly cb: EventDetailRendererCallbacks,
    private readonly factory: IAdapterFactory,
    private readonly formatter: IEventFormatter,
  ) {
    this.rankingCard = factory.createCard();
    this.matchCard = factory.createCard();
    this.playerCard = factory.createCard();
    this.roundNav = factory.createCard();
    this.overlay = factory.createOverlay();
    this.toast = factory.createToast();
  }
  async initialize(): Promise<void> {
    // 页面渲染时直接在这里渲染标签按钮
    this.renderTabs();
    // 从 sessionStorage 恢复上次选中的棋手（从等级分页面返回时）
    try {
      await this.sessionStore.initialize();
      const saved = await this.sessionStore.read<string>('event-detail-highlight');
      if (saved) {
        this.highlightedPlayerName = saved;
        await this.sessionStore.delete('event-detail-highlight');
      }
      // 恢复上次打开的对手弹窗状态（从弹窗内点对手 → 等级分页 → 返回，应回到弹窗）
      // 只在「非全新进入」时恢复：全新打开（从赛事列表点进来）不该莫名弹窗。
      // 浏览器返回时 navigation.type 为 back_forward；取不到类型时放宽放行。
      const navType = (performance.getEntriesByType?.('navigation') as PerformanceNavigationTiming[] | undefined)?.[0]?.type;
      const savedModal = await this.sessionStore.read<{ host: string; opponent: string }>('event-detail-opponent-modal');
      await this.sessionStore.delete('event-detail-opponent-modal'); // 无论是否恢复都清掉，避免残留
      if (navType !== 'navigate' && savedModal?.host && savedModal?.opponent) {
        this.pendingOpponent = { host: savedModal.host, opponent: savedModal.opponent };
        // 背景排名表改为高亮「弹窗所属棋手」，而不是上面那个对手名。
        // 否则返回后表格会滚到对手行，和弹窗标题（xx 的对手）对不上。
        // 必须在 renderRanking 之前设置，因为它在 rAF 里才真正执行高亮+滚动。
        this.highlightedPlayerName = cleanPlayerName(savedModal.host);
      }
    } catch { /* ignore */ }
    // 从 localStorage 恢复上次选择的排名模式
    try {
      await this.localStore.initialize();
      const savedMode = await this.localStore.read<string>('event-ranking-mode');
      if (savedMode === 'default' || savedMode === 'directWin' || savedMode === 'simple') {
        this.rankingMode = savedMode;
      }
    } catch { /* ignore */ }
    // 全局拦截跳转到等级分页面的链接，保存高亮信息
    document.addEventListener('click', (e) => {
      const link = (e.target as HTMLElement).closest('a[href*="player/?name="]') as HTMLAnchorElement | null;
      if (!link) return;
      const m = link.href.match(/player\/?\?name=([^&]+)/);
      if (!m || !m[1]) return;
      const name = decodeURIComponent(m[1]);
      this.sessionStore.write('event-detail-highlight', name).catch(() => { /* ignore */ });
      // 若点击来自对手弹窗，额外记下 "弹窗所属棋手 + 该对手"，返回时重建弹窗并定位
      const modal = link.closest('#opponent-modal');
      const host = modal?.getAttribute('data-host-name');
      const item = (link.closest('[data-opp-name]') as HTMLElement | null)?.dataset['oppName'];
      if (host && item) {
        this.sessionStore.write('event-detail-opponent-modal', { host, opponent: item }).catch(() => { /* ignore */ });
      }
    });
  }

  /** 取回并清空待恢复的弹窗状态（由 Page 在排名数据就绪后调用） */
  consumePendingOpponent(): { host: string; opponent: string } | null {
    const p = this.pendingOpponent;
    this.pendingOpponent = null;
    return p;
  }
  bindActions(): void {
    this.rankingCard.onAction((action, data) => {
      if (action === 'playerClick' && data?.['name']) {
        const name = String(data['name']);
        // 记住选中的棋手，用于从等级分页面返回时恢复高亮
        this.sessionStore.write('event-detail-highlight', name).catch(() => { /* ignore */ });
        this.cb.onPlayerClick(name);
      }
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
      // 宽度/收缩策略交给 detail.html 的 .detail-group-select 管理（需 min-width:0 才能收缩，否则长分组名会顶飞右侧按钮）
      selectWrapper.className = 'detail-group-select';
      const options = this.groups.map(g => ({
        value: String(g.id),
        label: g.name,
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
    // 「参赛名单」仅在无对阵表时补充显示（PDF 导入等场景有对阵表，故不会出现）
    if (this.playersTabAvailable) {
      TABS.push({ id: 'players', label: '👥 名单' });
    }
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

    // 添加排名模式扩展菜单
    const modeBtn = document.createElement('div');
    modeBtn.className = 'detail-tab';
    modeBtn.textContent = '⚙️';
    modeBtn.style.marginLeft = 'auto';
    modeBtn.style.position = 'relative';
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModeMenu(modeBtn);
    });
    container.appendChild(modeBtn);
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
    this.playerCard.setVisible(false);
  }
  showMatchesTab(): void {
    this.rankingCard.setVisible(false);
    this.playerCard.setVisible(false);
    this.roundNav.render();
    this.matchCard.render();
    this.roundNav.setVisible(true);
    this.matchCard.setVisible(true);
  }
  showPlayersTab(): void {
    this.rankingCard.setVisible(false);
    this.roundNav.setVisible(false);
    this.matchCard.setVisible(false);
    this.playerCard.render();
    this.playerCard.setVisible(true);
  }
  /**
   * 设置「参赛名单」标签的可用性
   * @description 只要分组存在任意一轮对阵表，就不显示名单标签（名单仅用于填补无对阵表的空窗期）
   */
  setPlayersTabAvailable(available: boolean): void {
    const changed = this.playersTabAvailable !== available;
    this.playersTabAvailable = available;
    // 标签被移除而当前正停留在该标签时，回退到排名标签并通知 Page 重新渲染
    if (changed && !available && this.activeTab === 'players') {
      this.activeTab = 'ranking';
      this.cb.onTabChange('ranking');
    }
    if (changed) this.renderTabs();
  }
  renderPlayers(data: PlayerListResult): void {
    this.playerData = data;
    this.hideOverlay();
    this.playerCard.setContent(
      (!data.players || data.players.length === 0)
        ? this.formatter.formatEmptyPlayers()
        : this.formatter.formatPlayerTable(data.players)
    );
    this.showPlayersTab();
    this.showContainer();
    this.flushContentReady();
  }
  renderRanking(result: RankingResult): void {
    this.hideOverlay();
    this.rankingCard.setContent(
      (!result.rankings || result.rankings.length === 0)
        ? this.formatter.formatEmptyRanking()
        : this.formatter.formatRankingTable(result.rankings, undefined, this.rankingMode)
    );
    this.rankingCard.render();
    this.showRankingTab();
    // 绑定行点击高亮
    this.bindRowHighlight();
    this.showContainer();
    // 恢复上次选中的行高亮和滚动位置（延迟到下一帧确保 DOM 渲染完成）
    if (this.highlightedPlayerName) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.highlightRow(this.highlightedPlayerName, true);
        });
      });
    }
    // 内容已渲染，触发等待中的一次性回调（如弹窗恢复）
    this.flushContentReady();
  }

  /** 注册一次性回调：内容下次渲染完成后触发（用于等待数据就绪） */
  onContentRenderedOnce(fn: () => void): void {
    this.contentReadyOnce.push(fn);
  }

  /** 触发并清空内容渲染回调 */
  private flushContentReady(): void {
    const waits = this.contentReadyOnce;
    this.contentReadyOnce = [];
    waits.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
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
    // 恢复上次选中的对阵卡片滚动位置（延迟到下一帧确保 DOM 渲染完成）
    if (this.highlightedPlayerName) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.scrollToMatchCard(this.highlightedPlayerName);
        });
      });
    }
    this.showContainer();
    this.flushContentReady();
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
  showOpponentModal(playerName: string, games: PlayerRanking['games'], rankMap?: Map<string, { rank: number; score: number }>, focusOpponent?: string): void {
    const html = this.formatter.formatOpponentModal(playerName, games, rankMap);
    if (!html) return;
    // 不再使用 opponentCard，直接添加到 body
    let modalEl = document.getElementById('opponent-modal-container');
    if (modalEl) modalEl.remove();
    modalEl = document.createElement('div');
    modalEl.id = 'opponent-modal-container';
    modalEl.innerHTML = html;
    // 点击遮罩背景或关闭按钮关闭弹框
    const overlay = modalEl.querySelector('#opponent-modal');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const actionEl = target.closest('[data-action]');
        if (actionEl && (actionEl as HTMLElement).dataset?.['action'] === 'closeModal') { modalEl.remove(); return; }
        // 点击遮罩背景（即 #opponent-modal 自身，非白色内容区）关闭
        if (target === overlay) modalEl.remove();
      });
    }
    document.body.appendChild(modalEl);
    // 恢复场景：定位并高亮上次查看的对手条目（等一帧确保布局完成）
    if (focusOpponent) {
      requestAnimationFrame(() => this.highlightOpponentItem(focusOpponent));
    }
  }

  /** 高亮弹窗内指定对手条目，并在弹窗内部滚动到可见位置 */
  highlightOpponentItem(opponentName: string): void {
    const list = document.getElementById('opponent-modal-list');
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-opp-name]'));
    items.forEach((el) => { el.style.background = ''; });
    if (!items.length) return;
    const target = items.find((el) => el.dataset['oppName'] === opponentName)
      ?? items.find((el) => el.dataset['oppName']?.includes(opponentName));
    if (!target) return;
    target.style.background = 'rgba(59,130,246,0.12)';
    // 在弹窗容器内部滚动，不用 scrollIntoView（否则会把背后的排名表也滚走）
    const top = target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
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
  /** 绑定排名表行点击高亮 */
  private bindRowHighlight(): void {
    const rows = document.querySelectorAll('tr[data-player-name]');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const name = (row as HTMLElement).dataset['playerName'] || '';
        this.highlightRow(name, false);
      });
    });
  }

  /** 高亮指定棋手的行并滚动到可见区域 */
  highlightRow(playerName: string, scrollTo: boolean): void {
    // 清除之前的高亮
    document.querySelectorAll('tr[data-player-name]').forEach(r => {
      (r as HTMLElement).style.background = '';
    });
    const target = document.getElementById(`rank-row-${playerName}`);
    if (target) {
      target.style.background = 'rgba(59,130,246,0.1)';
      if (scrollTo) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      this.highlightedPlayerName = playerName;
    }
  }

  /** 设置高亮棋手名（用于从等级分页面返回时恢复） */
  setHighlightedPlayer(name: string): void {
    this.highlightedPlayerName = name;
  }


  /** 滚动到包含目标棋手的对阵卡片 */
  scrollToMatchCard(playerName: string): void {
    // 清除之前的高亮
    document.querySelectorAll('[data-match]').forEach(card => {
      (card as HTMLElement).style.background = '';
    });
    // 查找包含目标棋手的对阵卡片
    const cards = Array.from(document.querySelectorAll('[data-match]'));
    for (const card of cards) {
      const match = card.getAttribute('data-match');
      if (match && match.includes(playerName)) {
        (card as HTMLElement).style.background = 'rgba(59,130,246,0.1)';
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break; // 只滚动到第一个匹配的卡片
      }
    }
  }

  /** 设置当前激活的标签页（用于从缓存恢复时） */
  setActiveTab(tab: 'ranking' | 'matches' | 'players'): void {
    this.activeTab = tab;
    this.renderTabs(); // 重新渲染标签按钮
  }
  /** 切换排名模式下拉菜单 */
  private toggleModeMenu(anchor: HTMLElement): void {
    const existing = document.getElementById('ranking-mode-menu');
    if (existing) { existing.remove(); return; }

    const MODES: Array<{ value: RankingMode; label: string; desc: string }> = [
      { value: 'default', label: '标准', desc: '积分→对手分→累进分→逆减分' },
      { value: 'directWin', label: '直胜', desc: '积分→对手分→直胜→逆减分' },
      { value: 'simple', label: '简易', desc: '积分→对手分→逆减分' },
    ];

    const menu = document.createElement('div');
    menu.id = 'ranking-mode-menu';
    menu.style.cssText = 'position:absolute;top:100%;right:0;background:white;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);z-index:100;min-width:220px;padding:4px 0;margin-top:4px;';

    MODES.forEach(m => {
      const item = document.createElement('div');
      const isActive = m.value === this.rankingMode;
      item.style.cssText = `padding:10px 14px;cursor:pointer;transition:background 0.15s;${isActive ? 'background:rgba(59,130,246,0.1);' : ''}`;
      item.innerHTML = `<div style="font-weight:${isActive ? '600' : '400'};color:${isActive ? '#3b82f6' : '#333'};font-size:0.9em;">${m.label}${isActive ? ' ✓' : ''}</div><div style="font-size:0.75em;color:#999;margin-top:2px;">${m.desc}</div>`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        document.removeEventListener('click', closeHandler);
        this.rankingMode = m.value;
        this.localStore.write('event-ranking-mode', m.value).catch(() => { /* ignore */ });
        this.cb.onRankingModeChange(m.value);
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(59,130,246,0.08)'; });
      item.addEventListener('mouseleave', () => { item.style.background = isActive ? 'rgba(59,130,246,0.1)' : ''; });
      menu.appendChild(item);
    });

    anchor.style.position = 'relative';
    anchor.appendChild(menu);

    // 点击外部关闭
    const closeHandler = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('click', closeHandler); }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  /** 获取当前排名模式 */
  getRankingMode(): RankingMode {
    return this.rankingMode;
  }

  /** 设置排名模式 */
  setRankingMode(mode: RankingMode): void {
    this.rankingMode = mode;
  }

  destroy(): void {
    this.overlay.destroy();
    this.rankingCard.destroy();
    this.matchCard.destroy();
    this.playerCard.destroy();
    this.roundNav.destroy();
    this.toast.destroy();
  }
}
