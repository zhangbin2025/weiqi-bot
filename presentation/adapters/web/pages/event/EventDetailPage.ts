/** 赛事详情页面控制器 */
import type { IPage, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { IPageCache } from '../../../../core/interfaces/IPageCache';
import type { EventQuerier, EventDetail } from '../../../../../application/event';
import type { IEventFormatter } from './IEventFormatter';
import type { Group, AgainstPlanResult } from '../../../../../services/event/types';
import type { RankingResult, RankingMode } from '../../../../../domain/ranking/types';
import type { PdfEventDetailRef, PdfEvent, PdfGroup as PdfGroupType } from '../../../../../services/event/PdfEventTypes';
import type { Match } from '../../../../../services/event/types';
import { GroupSelector } from '../../../../../domain/ranking/GroupSelector';
import { RankingCalculator } from '../../../../../domain/ranking/RankingCalculator';
import { PdfEventService } from '../../../../../services/event/PdfEventService';
import { EventDetailRenderer } from './EventDetailRenderer';

export interface EventDetailPageConfig {
  eventQuerier: EventQuerier;
  adapterFactory: IAdapterFactory; formatter: IEventFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onPlayerClick?: (playerName: string) => void;
  pageCache?: IPageCache;
}

interface Cache {
  groups: Group[]; selectedGroupId?: number | undefined; currentRound: number;
  totalRounds: number; currentTab: 'ranking' | 'matches'; rankingData: RankingResult | null;
  matchData: AgainstPlanResult | null; timestamp: number;
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
  private curRound = 1; private totRounds = 1;
  private curTab: 'ranking' | 'matches' = 'ranking';
  private init = false; private renderer: EventDetailRenderer;
  private rankingMode: RankingMode = 'default';
  private pdfService = new PdfEventService();

  /** PDF 模式：pdfGroupId → 数字 id 映射 */
  private pdfGroupMap = new Map<number, string>();
  /** PDF 模式：当前加载的 PdfEvent */
  private pdfEvent: PdfEvent | null = null;

  constructor(c: EventDetailPageConfig) {
    this.q = c.eventQuerier;
    this.nav = c.onNavigate; this.pcFn = c.onPlayerClick; this.cache = c.pageCache;
    this.renderer = new EventDetailRenderer({
      onGroupChange: (g) => this.selectGroup(g),
      onTabChange: (t) => { this.curTab = t as 'ranking' | 'matches'; this.renderContent(); this.saveCache(); },
      onPrevRound: () => { if (this.curRound > 1 && this.selGid) { this.curRound--; this.loadRound(); } },
      onNextRound: () => { if (this.curRound < this.totRounds && this.selGid) { this.curRound++; this.loadRound(); } },
      onPlayerClick: (n) => { if (this.pcFn) this.pcFn(n); },
      onShowOpponents: (n) => this.showOpp(n),
      onRankingModeChange: (mode) => { this.rankingMode = mode; this.renderContent(); },
      onRefresh: () => this.refresh(),
    }, c.adapterFactory, c.formatter);
  }

  async initialize(): Promise<void> {
    if (this.init) return;
    this.renderer.initialize(); this.renderer.bindActions();
    await this.pdfService.init();
    this.init = true;
  }

  handleParams(p: PageParams): void {
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
    const raw = sessionStorage.getItem('pdf-event-detail');
    if (!raw) {
      this.renderer.renderError('缺少导入数据，请返回重新操作');
      return;
    }

    try {
      const ref: PdfEventDetailRef = JSON.parse(raw);
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
    this.rankData = calculator.calculate(allMatches, this.rankingMode);
    this.totRounds = this.rankData.totalRounds;
    this.curRound = this.rankData.completedRounds || this.rankData.totalRounds;

    // 构建对阵数据
    this.matchData = {
      rows: allMatches,
      totalBout: this.totRounds,
      success: true,
    };

    this.renderContent();
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
      this.renderer.setActiveTab(this.curTab); // 同步渲染器的标签页状态
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
      const rr = await this.q.getGroupRanking(this.eid, g.id, undefined,
        (msg, pct) => this.renderer.showProgress(20 + pct * 0.6, msg), forceRefresh);
      this.rankData = rr; this.totRounds = rr.totalRounds; this.curRound = rr.totalRounds;
      this.renderer.showProgress(90, '正在加载对阵数据...');
      this.matchData = await this.q.getGroupMatches(g.id, this.curRound);
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
    if (this.source === 'pdf') {
      // PDF 模式：对阵数据已在内存中，只切换轮次显示
      this.renderer.renderRoundNav(this.curRound, this.totRounds);
      if (this.matchData) this.renderer.renderMatches(this.matchData, this.buildScoreMap(this.curRound));
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
    this.pdfEvent = null; this.pdfGroupMap.clear();
  }
}
