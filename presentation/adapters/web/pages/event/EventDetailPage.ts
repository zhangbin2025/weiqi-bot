/** 赛事详情页面控制器 */
import type { IPage, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { IPageCache } from '../../../../core/interfaces/IPageCache';
import type { EventQuerier, EventDetail } from '../../../../../application/event';
import type { IEventFormatter } from './IEventFormatter';
import type { Group, PlayerListResult, AgainstPlanResult } from '../../../../../services/event/types';
import type { RankingResult, RankingMode } from '../../../../../domain/ranking/types';
import type { PdfEventDetailRef, PdfEvent, PdfGroup as PdfGroupType } from '../../../../../services/event/PdfEventTypes';
import type { Match } from '../../../../../services/event/types';
import { GroupSelector } from '../../../../../domain/ranking/GroupSelector';
import { RankingCalculator } from '../../../../../domain/ranking/RankingCalculator';
import { PdfEventService } from '../../../../../services/event/PdfEventService';
import { EventDetailRenderer } from './EventDetailRenderer';
import { SessionStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/SessionStorageAdapter';
import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

/** ⚙️ 菜单里「当前选中的排名插件」持久化键；没有/失效时一律回落内置排序 */
const RANKING_PLUGIN_KEY = 'event-ranking-plugin';

/** 读取持久化的插件选择；裸字符串或 JSON 字符串都兼容（LocalStorageAdapter 有 namespace 时会 JSON 序列化） */
function readRankingPluginSelection(store: LocalStorageAdapter): string | undefined {
  const raw = store.readSync<string>(RANKING_PLUGIN_KEY);
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return raw.trim();
}

export interface EventDetailPageConfig {
  eventQuerier: EventQuerier;
  adapterFactory: IAdapterFactory; formatter: IEventFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onPlayerClick?: (playerName: string) => void;
  pageCache?: IPageCache;
}

interface Cache {
  groups: Group[]; selectedGroupId?: number | undefined; currentRound: number;
  totalRounds: number; currentTab: 'ranking' | 'matches' | 'players'; rankingData: RankingResult | null;
  matchData: AgainstPlanResult | null; playerData: PlayerListResult | null;
  playersTabAvailable: boolean;
  /** 生成该缓存时选中的排名插件口径（undefined=内置）；恢复时据此判断是否需重算 */
  rankingPluginId?: string;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000;

export class EventDetailPage implements IPage {
  readonly title = '赛事详情';
  private q!: EventQuerier;
  private nav?: ((p: string, ps?: Record<string, string>) => void) | undefined;
  private pcFn?: (((n: string) => void) | undefined);
  private cache?: IPageCache | undefined;
  private eid?: number; private eTitle?: string;
  private source: 'api' | 'pdf' = 'api';
  private groups: Group[] = []; private selGid?: number | undefined;
  private rankData: RankingResult | null = null;
  private matchData: AgainstPlanResult | null = null;
  private playerData: PlayerListResult | null = null;
  /** 「参赛名单」标签是否可用（无对阵表时列出报名名单） */
  private playersTabAvailable = false;
  private curRound = 1; private totRounds = 1;
  private curTab: 'ranking' | 'matches' | 'players' = 'ranking';
  private init = false; private renderer: EventDetailRenderer;
  private rankingMode: RankingMode = 'default';
  private pdfService = new PdfEventService();
  private readonly sessionStore = new SessionStorageAdapter('weiqi-bot');
  private readonly localStore = new LocalStorageAdapter('weiqi-bot');
  /** 当前选中的排名插件 id；undefined = 使用无插件的内置排序（默认） */
  private selectedRankingPluginId: string | undefined;

  /** PDF 模式：pdfGroupId → 数字 id 映射 */
  private pdfGroupMap = new Map<number, string>();
  /** PDF 模式：当前加载的 PdfEvent */
  private pdfEvent: PdfEvent | null = null;
  /** 惰性装配的插件系统（只在启用插件时才会真正加载 Worker/wasm） */
  private pluginSystem: import('../../../../../application/plugin/PluginSystem').PluginSystem | undefined;

  constructor(c: EventDetailPageConfig) {
    this.q = c.eventQuerier;
    this.nav = c.onNavigate; this.pcFn = c.onPlayerClick; this.cache = c.pageCache;
    this.renderer = new EventDetailRenderer({
      onGroupChange: (g) => this.selectGroup(g),
      onTabChange: (t) => { this.curTab = t as 'ranking' | 'matches' | 'players'; this.renderContent(); this.saveCache(); },
      onPrevRound: () => { if (this.curRound > 1 && this.selGid) { this.curRound--; this.loadRound(); } },
      onNextRound: () => { if (this.curRound < this.totRounds && this.selGid) { this.curRound++; this.loadRound(); } },
      onPlayerClick: (n) => { if (this.pcFn) this.pcFn(n); },
      onShowOpponents: (n) => this.showOpp(n),
      onRankingModeChange: (mode) => { this.rankingMode = mode; if (this.selGid) this.selectGroup(String(this.selGid), true); },
      onRankingPluginChange: (id) => void this.setRankingPlugin(id),
      onRefresh: () => this.refresh(),
    }, c.adapterFactory, c.formatter);
  }

  async initialize(): Promise<void> {
    if (this.init) return;
    await this.renderer.initialize(); this.renderer.bindActions();
    await this.pdfService.init();
    // 恢复上次选中的排名插件（用户明确要求：只要上次选了插件，下次默认仍用它排序）。
    // 清单加载完会校验该 id 是否仍存在/启用；失效时自动清除并回落内置。
    try {
      await this.localStore.initialize();
      this.selectedRankingPluginId = readRankingPluginSelection(this.localStore);
    } catch { this.selectedRankingPluginId = undefined; }
    await this.refreshRankingPluginMenu();
    this.init = true;
  }

  /** 拉取已启用的排名插件，喂给 ⚙️ 菜单；同时校验当前选择是否仍有效 */
  private async refreshRankingPluginMenu(): Promise<void> {
    try {
      const sys = await this.ensurePluginSystem();
      if (!sys) return;
      const items = (await sys.artifacts.list())
        .filter((a) => a.enabled && a.pointId === 'ranking.tiebreak')
        .map((a) => ({ id: a.id, name: a.name }));
      this.renderer.setRankingPlugins(items, this.selectedRankingPluginId);
    } catch {
      this.renderer.setRankingPlugins([]);
    }
  }

  /** 选择/取消某个排名插件：持久化 + 立刻重算当前分组排名 */
  private async setRankingPlugin(id: string | undefined): Promise<void> {
    this.selectedRankingPluginId = id;
    try {
      if (id) await this.localStore.write(RANKING_PLUGIN_KEY, id);
      else await this.localStore.delete(RANKING_PLUGIN_KEY);
    } catch { /* 存储不可用时不阻塞排序切换 */ }
    if (this.selGid) {
      if (this.source === 'pdf') await this.loadPdfGroup(this.selGid);
      else await this.selectGroup(String(this.selGid), true);
    }
  }

  handleParams(p: PageParams): void {
    // 页面实例在 SPA 内复用：每次重新进入都刷新一次插件清单
    // （用户可能在对话页新建/启用/删除了插件），不阻塞主流程。
    void this.refreshRankingPluginMenu();
    if (p['source'] === 'pdf') {
      this.source = 'pdf';
      this.rankingMode = 'directWin';
      this.renderer.setRankingMode('directWin');
      this.loadPdfData();
      return;
    }
    if (p['eventId']) this.eid = parseInt(p['eventId'], 10);
    if (p['title']) this.eTitle = p['title'];
    this.loadEvent();
  }

  private async loadPdfData(): Promise<void> {
    await this.sessionStore.initialize();
    const raw = await this.sessionStore.read<string>('pdf-event-detail');
    if (!raw) {
      this.renderer.renderError('缺少导入数据，请返回重新操作');
      return;
    }

    try {
      const ref = raw as unknown as PdfEventDetailRef;
      const event = await this.pdfService.getEvent(ref.eventId);
      if (!event) {
        this.renderer.renderError('导入数据已丢失，请重新导入');
        return;
      }

      this.pdfEvent = event;
      this.eTitle = event.title;

      // 将 PdfGroup 转为 Group 格式，每个分组分配唯一数字 id
      this.pdfGroupMap.clear();
      this.groups = event.groups.map((g, idx) => {
        const numId = idx + 1;
        this.pdfGroupMap.set(numId, g.id);
        return {
          id: numId,
          name: g.name,
          players: g.rounds.reduce((s, r) => s + r.matches.length, 0),
        };
      });

      // 选中目标分组
      const targetNumId = this.findPdfGroupNumId(ref.groupId);
      const dg = targetNumId ?? GroupSelector.selectDefault(this.groups)?.id ?? this.groups[0]?.id;
      this.selGid = dg;

      this.renderer.renderGroupSelect(this.groups, this.selGid);
      await this.loadPdfGroup(this.selGid!);
      this.renderer.showContainer();
    } catch (e) {
      console.error('加载PDF数据失败', e as Error);
      this.renderer.renderError('加载数据失败');
    }
  }

  /** 修正分组中的棋手ID：同名棋手应使用相同ID，修复轮空等场景下p1Id=0的问题 */
  private fixPlayerIds(group: { rounds: Array<{ matches: Match[] }> }): void {
    // 先收集 name -> id 映射（优先使用非零ID）
    const nameToId = new Map<string, number>();
    for (const r of group.rounds) {
      for (const m of r.matches) {
        if (m.p1Name && m.p1Id && !nameToId.has(m.p1Name)) nameToId.set(m.p1Name, m.p1Id);
        if (m.p2Name && m.p2Id && !nameToId.has(m.p2Name)) nameToId.set(m.p2Name, m.p2Id);
      }
    }
    // 对没有编号的棋手分配负数ID
    let fakeId = -1;
    for (const r of group.rounds) {
      for (const m of r.matches) {
        for (const name of [m.p1Name, m.p2Name]) {
          if (name && !nameToId.has(name)) {
            nameToId.set(name, fakeId--);
          }
        }
      }
    }
    // 统一修正所有 match 的 ID
    for (const r of group.rounds) {
      for (const m of r.matches) {
        if (m.p1Name && nameToId.has(m.p1Name)) m.p1Id = nameToId.get(m.p1Name)!;
        if (m.p2Name && nameToId.has(m.p2Name)) m.p2Id = nameToId.get(m.p2Name)!;
      }
    }
  }

  /** 根据 pdfGroupId（uuid string）找到对应的数字 id */
  private findPdfGroupNumId(pdfGroupId: string): number | undefined {
    for (const [numId, pgId] of this.pdfGroupMap) {
      if (pgId === pdfGroupId) return numId;
    }
    return undefined;
  }

  /** PDF 模式：根据数字 id 加载分组数据 */
  private async loadPdfGroup(numId: number): Promise<void> {
    if (!this.pdfEvent) return;
    const pdfGroupId = this.pdfGroupMap.get(numId);
    if (!pdfGroupId) return;

    const group = this.pdfEvent.groups.find(g => g.id === pdfGroupId);
    if (!group) return;

    // 修正棋手ID：确保同名棋手在不同轮次使用相同ID（修复轮空棋手p1Id=0的问题）
    this.fixPlayerIds(group);

    // 计算排名
    const allMatches = group.rounds.flatMap(r => r.matches);
    const calculator = new RankingCalculator();
    const baseRank = calculator.calculate(allMatches, this.rankingMode);
    this.rankData = await this.applyRankingPlugins(baseRank);
    this.totRounds = this.rankData.totalRounds;
    this.curRound = this.rankData.completedRounds || this.rankData.totalRounds;

    // 构建对阵数据
    this.matchData = {
      rows: allMatches,
      totalBout: this.totRounds,
      success: true,
    };

    // PDF 导入本身就是对阵表，不存在「无对阵表」的空窗期，名单标签不参与
    this.playersTabAvailable = false;
    this.playerData = null;
    this.renderer.setPlayersTabAvailable(false);

    this.renderContent();
  }

  /**
   * 装配（复用）插件系统。构造本身不加载 wasm/Worker，只有真正 run() 才创建。
   * 失败返回 undefined，页面静默回落内置能力。
   *
   * 生命周期：赛事页是 SPA 内页面，pluginSystem 在页面实例上复用，路由切走时实例销毁、
   * Worker 随之被 GC；单页内不为每次排名计算新建 runtime，避免反复加载 wasm。
   */
  private async ensurePluginSystem(): Promise<import('../../../../../application/plugin/PluginSystem').PluginSystem | undefined> {
    if (this.pluginSystem) return this.pluginSystem;
    try {
      const mod = await import('../../../../../application/plugin/PluginSystem');
      const sys = await mod.createPluginSystem();
      this.pluginSystem = sys;
      return sys;
    } catch {
      return undefined;
    }
  }

  /**
   * 只有当用户通过 ⚙️ 菜单显式选择了某个插件时才应用插件排序；
   * 未选择（默认）一律返回内置结果，插件「已启用」不再等于「正在使用」。
   * 任何失败都静默回落内置结果，保证赛事详情页永远不因插件而白屏。
   */
  private async applyRankingPlugins(rankData: RankingResult): Promise<RankingResult> {
    if (!this.selectedRankingPluginId) return rankData;
    try {
      const sys = await this.ensurePluginSystem();
      if (!sys) return rankData;
      return await sys.applyRanking(rankData, this.selectedRankingPluginId);
    } catch {
      return rankData;
    }
  }

  private ckey(): string { return this.eid ? `event-detail-${this.eid}` : ''; }

  private saveCache(): void {
    if (!this.cache || !this.eid) return;
    this.cache.set(this.ckey(), JSON.stringify({
      groups: this.groups, selectedGroupId: this.selGid, currentRound: this.curRound,
      totalRounds: this.totRounds, currentTab: this.curTab, rankingData: this.rankData,
      matchData: this.matchData, playerData: this.playerData,
      playersTabAvailable: this.playersTabAvailable,
      ...(this.selectedRankingPluginId ? { rankingPluginId: this.selectedRankingPluginId } : {}),
      timestamp: Date.now(),
    } as Cache));
  }

  private tryCache(): boolean {
    if (!this.cache || !this.eid) return false;
    const raw = this.cache.get(this.ckey());
    if (!raw) return false;
    try {
      const c: Cache = JSON.parse(raw);
      if (Date.now() - c.timestamp > CACHE_TTL) { this.cache.remove(this.ckey()); return false; }
      this.groups = c.groups; this.selGid = c.selectedGroupId;
      this.curRound = c.currentRound; this.totRounds = c.totalRounds;
      this.curTab = c.currentTab; this.rankData = c.rankingData; this.matchData = c.matchData;
      // 旧缓存没有名单字段，回退为 false（名单标签随之隐藏）
      this.playerData = c.playerData ?? null;
      this.playersTabAvailable = c.playersTabAvailable ?? false;
      this.renderer.setPlayersTabAvailable(this.playersTabAvailable);
      this.renderer.setActiveTab(this.curTab); // 同步渲染器的标签页状态
      this.renderer.renderGroupSelect(this.groups, this.selGid);
      this.renderContent();
      this.renderer.showContainer();
      // 缓存是「当时选中口径」下的结果。若当前选择的插件口径与缓存不一致
      // （跨版本旧缓存，或插件被停用/删除导致选择被清），异步按当前口径重新加载；
      // 一致时直接显示缓存，秒开且口径正确，不会二次应用插件。
      if (c.rankingPluginId !== this.selectedRankingPluginId) {
        void this.recomputeForCurrentRankingPlugin();
      }
      return true;
    } catch { return false; }
  }

  /** 缓存口径与当前插件选择不一致时，按当前口径重新生成当前分组数据并刷新缓存 */
  private async recomputeForCurrentRankingPlugin(): Promise<void> {
    if (!this.selGid) return;
    if (this.source === 'pdf') {
      await this.loadPdfGroup(this.selGid);
    } else {
      await this.selectGroup(String(this.selGid), true);
    }
    this.saveCache();
  }

  private async loadEvent(): Promise<void> {
    if (!this.eid) return;
    if (this.tryCache()) return;
    this.renderer.showProgress(5, '正在加载比赛分组...');
    try {
      const d: EventDetail = await this.q.getEventDetail(this.eid);
      this.groups = d.groups;
      const dg = GroupSelector.selectDefault(this.groups);
      this.renderer.renderGroupSelect(this.groups, dg?.id);
      if (dg) await this.selectGroup(String(dg.id));
    } catch (e) { console.error('加载赛事详情失败', e as Error); this.renderer.renderError('加载失败，请返回重试'); }
  }

  private async selectGroup(gid: string, forceRefresh: boolean = false): Promise<void> {
    const numGid = parseInt(gid, 10);
    const g = this.groups.find((x) => x.id === numGid);
    if (!g) return;

    this.selGid = g.id;
    this.renderer.renderGroupSelect(this.groups, this.selGid);

    if (this.source === 'pdf') {
      // PDF 模式：直接从内存加载分组数据
      await this.loadPdfGroup(g.id);
      return;
    }

    // API 模式
    if (!this.eid) return;
    this.renderer.showProgress(20, `正在加载「${g.name}」数据...`);
    try {
      const rr = await this.q.getGroupRanking(this.eid, g.id, this.rankingMode,
        (msg, pct) => this.renderer.showProgress(20 + pct * 0.6, msg), forceRefresh);
      this.rankData = await this.applyRankingPlugins(rr);
      this.totRounds = rr.totalRounds; this.curRound = rr.totalRounds;
      this.renderer.showProgress(90, '正在加载对阵数据...');
      this.matchData = await this.q.getGroupMatches(g.id, this.curRound);
      // 只要存在任意一轮对阵表，就不再展示参赛名单（名单仅用于填补无对阵表的空窗期）
      const hasMatches = (rr.rankings?.length ?? 0) > 0 || (this.matchData?.rows?.length ?? 0) > 0;
      this.playersTabAvailable = !hasMatches;
      if (this.playersTabAvailable) {
        this.renderer.showProgress(95, '正在加载参赛名单...');
        this.playerData = await this.q.getGroupPlayers(g.id);
      } else {
        this.playerData = null;
      }
      this.renderer.setPlayersTabAvailable(this.playersTabAvailable);
      // 无对阵表时标签组只保留「名单」，必须强制切过去，
      // 否则 activeTab 还停在已不存在的 ranking/matches，导致无按钮高亮且内容空白
      if (this.playersTabAvailable) {
        this.curTab = 'players';
        this.renderer.setActiveTab('players');
      }
      this.renderer.showProgress(100, '加载完成');
      this.renderContent(); this.saveCache();
    } catch (e) { console.error('加载分组数据失败', e as Error); this.renderer.renderError('加载分组数据失败，请重试'); }
  }

  private buildScoreMap(round?: number): Map<string, number> {
    const m = new Map<string, number>();
    if (!this.rankData?.rankings) return m;
    this.rankData.rankings.forEach((r) => {
      const score = (r.games && round != null)
        ? r.games.filter(g => g.bout < round).reduce((s, g) => s + (g.result === 'win' ? 2 : g.result === 'draw' ? 1 : 0), 0)
        : r.score;
      m.set(r.name, score);
      const cn = r.name.replace(/\|[\d\w:_-]+$/, '').trim();
      if (cn !== r.name) m.set(cn, score);
    });
    return m;
  }

  /** PDF 模式：从全部对阵数据中按轮次过滤 */
  private filterMatchesByRound(data: AgainstPlanResult, round: number): AgainstPlanResult {
    if (this.source !== 'pdf') return data;
    return {
      rows: data.rows.filter(m => m.bout === round),
      totalBout: data.totalBout,
      success: data.success,
    };
  }

  private renderContent(): void {
    if (this.curTab === 'ranking' && this.rankData) {
      this.renderer.renderRanking(this.rankData);
    } else if (this.curTab === 'matches' && this.matchData) {
      this.renderer.renderRoundNav(this.curRound, this.totRounds);
      const roundMatches = this.filterMatchesByRound(this.matchData, this.curRound);
      this.renderer.renderMatches(roundMatches, this.buildScoreMap(this.curRound));
    } else if (this.curTab === 'players' && this.playerData) {
      this.renderer.renderPlayers(this.playerData);
    }
    // 数据渲染后尝试恢复返回前的对手弹窗（内部只消费一次）
    this.tryRestoreOpponentModal();
  }

  private async loadRound(): Promise<void> {
    if (!this.selGid) return;
    if (this.source === 'pdf') {
      // PDF 模式：对阵数据已在内存中，按轮次过滤后显示
      this.renderer.renderRoundNav(this.curRound, this.totRounds);
      if (this.matchData) {
        const roundMatches = this.filterMatchesByRound(this.matchData, this.curRound);
        this.renderer.renderMatches(roundMatches, this.buildScoreMap(this.curRound));
      }
      return;
    }
    try {
      const r = await this.q.getGroupMatches(this.selGid, this.curRound);
      this.matchData = r;
      this.renderer.renderRoundNav(this.curRound, this.totRounds);
      this.renderer.renderMatches(r, this.buildScoreMap(this.curRound));
    } catch (e) { console.error('加载轮次数据失败', e as Error); }
  }

  private async refresh(): Promise<void> {
    if (!this.selGid) return;
    if (this.source === 'pdf') {
      await this.loadPdfGroup(this.selGid);
      this.renderer.toast.success('数据已刷新');
      return;
    }
    await this.selectGroup(String(this.selGid), true);
    this.renderer.toast.success('数据已刷新');
  }

  private showOpp(name: string, focusOpponent?: string): void {
    if (!this.rankData) return;
    const p = this.rankData.rankings.find((x) => x.name === name);
    if (!p?.games) return;
    const rm = new Map<string, { rank: number; score: number }>();
    this.rankData.rankings.forEach((x) => {
      rm.set(x.name.replace(/\|[\d\w:_-]+$/, '').trim(), { rank: x.rank, score: x.score });
    });
    this.renderer.showOpponentModal(name, p.games, rm, focusOpponent);
  }

  /**
   * 尝试恢复返回前的对手弹窗
   * @description 从弹窗点对手 → 等级分页 → 浏览器返回，应回到弹窗并定位到该对手条目。
   * 排名数据可能还没就绪（缓存未命中时是异步加载），故注册一次性的 "内容已渲染" 回调避免竞态。
   */
  private tryRestoreOpponentModal(): void {
    const pending = this.renderer.consumePendingOpponent();
    if (!pending) return;
    const { host, opponent } = pending;

    // 背景排名表的高亮/滚动由 Renderer 在 initialize() 里统一处理
    const open = (): void => { this.showOpp(host, opponent); };

    if (this.rankData) {
      open();
      return;
    }
    this.renderer.onContentRenderedOnce(open);
  }

  render(): void { this.renderer.render(); }

  destroy(): void {
    this.renderer.destroy(); this.groups = [];
    this.rankData = null; this.matchData = null; this.init = false;
    this.pdfEvent = null; this.pdfGroupMap.clear();
  }
}
