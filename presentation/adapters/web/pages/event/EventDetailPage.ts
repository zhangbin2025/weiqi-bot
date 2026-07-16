/** 赛事详情页面控制器 */
import type { IPage, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { IPageCache } from '../../../../core/interfaces/IPageCache';
import type { EventQuerier, EventDetail } from '../../../../../application/event';
import type { IEventFormatter } from './IEventFormatter';
import type { Group, AgainstPlanResult } from '../../../../../services/event/types';
import type { RankingResult } from '../../../../../domain/ranking/types';
import { GroupSelector } from '../../../../../domain/ranking/GroupSelector';
import { EventDetailRenderer } from './EventDetailRenderer';
export interface EventDetailPageConfig {
  eventQuerier: EventQuerier;
  adapterFactory: IAdapterFactory; formatter: IEventFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onPlayerClick?: (playerName: string) => void;
  /** 页面缓存（可选，用于返回导航时恢复数据） */
  pageCache?: IPageCache;
}
interface Cache { groups: Group[]; selectedGroupId?: number | undefined; currentRound: number;
  totalRounds: number; currentTab: 'ranking' | 'matches'; rankingData: RankingResult | null;
  matchData: AgainstPlanResult | null; timestamp: number; }
const CACHE_TTL = 5 * 60 * 1000;
export class EventDetailPage implements IPage {
  readonly title = '赛事详情';
  private q!: EventQuerier;
  private nav?: ((p: string, ps?: Record<string, string>) => void) | undefined;
  private pcFn?: ((n: string) => void) | undefined;
  private cache?: IPageCache | undefined;
  private eid?: number; private eTitle?: string;
  private groups: Group[] = []; private selGid?: number | undefined;
  private rankData: RankingResult | null = null;
  private matchData: AgainstPlanResult | null = null;
  private curRound = 1; private totRounds = 1;
  private curTab: 'ranking' | 'matches' = 'ranking';
  private init = false; private renderer: EventDetailRenderer;
  constructor(c: EventDetailPageConfig) {
    this.q = c.eventQuerier;
    this.nav = c.onNavigate; this.pcFn = c.onPlayerClick; this.cache = c.pageCache;
    this.renderer = new EventDetailRenderer({
      onGroupChange: (g) => this.selectGroup(g), onTabChange: (t) => { this.curTab = t as 'ranking' | 'matches'; this.renderContent(); },
      onPrevRound: () => { if (this.curRound > 1 && this.selGid) { this.curRound--; this.loadRound(); } },
      onNextRound: () => { if (this.curRound < this.totRounds && this.selGid) { this.curRound++; this.loadRound(); } },
      onPlayerClick: (n) => { if (this.pcFn) this.pcFn(n); },
      onShowOpponents: (n) => this.showOpp(n),
      onRefresh: () => this.refresh(),
    }, c.adapterFactory, c.formatter);
  }
  async initialize(): Promise<void> {
    if (this.init) return; this.renderer.initialize(); this.renderer.bindActions(); this.init = true;
  }
  handleParams(p: PageParams): void {
    if (p['eventId']) this.eid = parseInt(p['eventId'], 10);
    if (p['title']) this.eTitle = p['title'];
    this.loadEvent();
  }
  private ckey(): string { return this.eid ? `event-detail-${this.eid}` : ''; }
  private saveCache(): void {
    if (!this.cache || !this.eid) return;
    this.cache.set(this.ckey(), JSON.stringify({
      groups: this.groups, selectedGroupId: this.selGid, currentRound: this.curRound,
      totalRounds: this.totRounds, currentTab: this.curTab, rankingData: this.rankData,
      matchData: this.matchData, timestamp: Date.now(),
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
      this.renderer.renderGroupSelect(this.groups, this.selGid);
      this.renderContent();
      this.renderer.showContainer();
      return true;
    } catch { return false; }
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
    const g = this.groups.find((x) => String(x.id) === gid);
    if (!g || !this.eid) return;
    this.selGid = g.id;
    this.renderer.showProgress(20, `正在加载「${g.name}」数据...`);
    try {
      const rr = await this.q.getGroupRanking(this.eid, g.id, undefined,
        (msg, pct) => this.renderer.showProgress(20 + pct * 0.6, msg), forceRefresh);
      this.rankData = rr; this.totRounds = rr.totalRounds; this.curRound = rr.totalRounds;
      this.renderer.showProgress(90, '正在加载对阵数据...');
      this.matchData = await this.q.getGroupMatches(g.id, this.curRound);
      this.renderer.showProgress(100, '加载完成');
      this.renderContent(); this.saveCache();
    } catch (e) { console.error('加载分组数据失败', e as Error); this.renderer.renderError('加载分组数据失败，请重试'); }
  }
  /** 根据轮次计算累积积分（第 1 ~ round-1 轮），胜=2 和=1 负=0 */
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
  private renderContent(): void {
    if (this.curTab === 'ranking' && this.rankData) {
      this.renderer.renderRanking(this.rankData);
    } else if (this.curTab === 'matches' && this.matchData) {
      this.renderer.renderRoundNav(this.curRound, this.totRounds);
      this.renderer.renderMatches(this.matchData, this.buildScoreMap(this.curRound));
    }
  }
  private async loadRound(): Promise<void> {
    if (!this.selGid) return;
    try {
      const r = await this.q.getGroupMatches(this.selGid, this.curRound);
      this.matchData = r;
      this.renderer.renderRoundNav(this.curRound, this.totRounds);
      this.renderer.renderMatches(r, this.buildScoreMap(this.curRound));
    } catch (e) { console.error('加载轮次数据失败', e as Error); }
  }
  /** 强制刷新数据（清除缓存重新加载） */
  private async refresh(): Promise<void> {
    if (!this.selGid) return;
    await this.selectGroup(String(this.selGid), true);
    this.renderer.toast.success('数据已刷新');
  }

  private showOpp(name: string): void {
    if (!this.rankData) return;
    const p = this.rankData.rankings.find((x) => x.name === name);
    if (!p?.games) return;
    const rm = new Map<string, { rank: number; score: number }>();
    this.rankData.rankings.forEach((x) => {
      rm.set(x.name.replace(/\|[\d\w:_-]+$/, '').trim(), { rank: x.rank, score: x.score });
    });
    this.renderer.showOpponentModal(name, p.games, rm);
  }
  render(): void { this.renderer.render(); }
  destroy(): void {
    this.renderer.destroy(); this.groups = [];
    this.rankData = null; this.matchData = null; this.init = false;
  }
}
