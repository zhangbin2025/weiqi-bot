/**
 * 云比赛首页控制器
 * @module presentation/pages/event/EventPage
 */
import type { IPage, PageParams, IAdapterFactory } from '../../../../core/interfaces';
import type { EventQuerier, EventHistoryEntry } from '../../../../../application/event';
import type { IEventFormatter } from './IEventFormatter';
import type { RecentEntry } from './EventRenderer';
import type { Match } from '../../../../../services/event/types';
import type { PdfMatch } from '../../../../../services/pdf/types';
import type { IKeyValueStorageAdapter } from '../../../../../infrastructure/storage/interfaces/IKeyValueStorage';
import { EventRenderer } from './EventRenderer';
import { PdfMatchParser } from '../../../../../services/pdf/PdfMatchParser';
import { PdfEventService } from '../../../../../services/event/PdfEventService';

type EventTab = 'query' | 'import' | 'recent';

const WIN = 2;
const DRAW = 1;
const LOSS = 0;

const STORAGE_KEY_AREA = 'lastArea';

export interface EventPageConfig {
  eventQuerier: EventQuerier;
  storage: IKeyValueStorageAdapter;
  adapterFactory: IAdapterFactory;
  formatter: IEventFormatter;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}

export class EventPage implements IPage {
  readonly title = '云比赛';
  private eventQuerier: EventQuerier;
  private storage: IKeyValueStorageAdapter;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private area: string = '';
  private month: number = 1;
  private keyword: string = '';
  private initialized = false;
  private currentTab: EventTab = 'query';
  private renderer: EventRenderer;

  // PDF 导入
  private pdfParser = new PdfMatchParser();
  private pdfService = new PdfEventService();

  constructor(config: EventPageConfig) {
    this.eventQuerier = config.eventQuerier;
    this.storage = config.storage;
    this.onNavigate = config.onNavigate;
    this.renderer = new EventRenderer(
      {
        onQuery: (area, month, keyword) => this.queryEvents(area, month, keyword),
        onTabChange: (tab) => this.switchTab(tab as EventTab),
        onClearHistory: () => this.clearHistory(),
        onViewHistory: (id) => this.viewHistory(id),
        onImportFiles: (files) => this.handleImportFiles(files),
      },
      config.adapterFactory,
      config.formatter,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 从 localStorage 读取上次选择的省份
    let lastArea: string | undefined;
    try {
      const saved = await this.storage.read<string>(STORAGE_KEY_AREA);
      if (saved) lastArea = saved;
    } catch { /* ignore */ }
    this.renderer.initialize(lastArea);
    this.renderer.bindActions();
    await this.pdfService.init();
    this.initialized = true;
  }

  handleParams(params: PageParams): void {
    if (params['keyword']) {
      this.keyword = params['keyword'];
      this.renderer.input.setValue(params['keyword']);
    }
    if (params['area']) {
      this.area = params['area'];
      this.renderer.setArea(params['area']);
    }
    if (params['month']) {
      const m = parseInt(params['month'], 10);
      if (!isNaN(m)) {
        this.month = m;
        this.renderer.setMonth(m);
      }
    }
  }

  async switchTab(tabName: EventTab): Promise<void> {
    this.currentTab = tabName;
    this.renderer.showTab(tabName);
    if (tabName === 'recent') await this.loadRecent();
  }

  /** 加载最近列表：云比赛 + PDF导入 合并 */
  private async loadRecent(): Promise<void> {
    const entries: RecentEntry[] = [];

    // 云比赛历史
    try {
      const history = await this.eventQuerier.queryHistory({ limit: 20 }) ?? [];
      for (const h of history) {
        entries.push({
          id: h.id,
          title: h.title,
          source: 'cloud',
          visitedAt: h.visitedAt,
          eventId: h.eventId,
        });
      }
    } catch { /* ignore */ }

    // PDF导入历史
    try {
      const pdfEvents = await this.pdfService.listEvents();
      for (const e of pdfEvents) {
        const totalRounds = e.groups.reduce((s, g) => s + g.rounds.length, 0);
        entries.push({
          id: `pdf:${e.id}`,
          title: e.title,
          source: 'pdf',
          visitedAt: e.updatedAt,
          groupCount: e.groups.length,
          roundCount: totalRounds,
        });
      }
    } catch { /* ignore */ }

    // 按时间倒序
    entries.sort((a, b) => b.visitedAt - a.visitedAt);
    this.renderer.renderRecent(entries);
  }

  async clearHistory(): Promise<void> {
    await this.eventQuerier.clearHistory();
    this.renderer.renderRecent([]);
    this.renderer.toast.success('历史记录已清除');
  }

  private async viewHistory(id: string): Promise<void> {
    // PDF 导入条目
    if (id.startsWith('pdf:')) {
      const eventId = id.slice(4);
      const event = await this.pdfService.getEvent(eventId);
      if (event && event.groups.length > 0) {
        sessionStorage.setItem('pdf-event-detail', JSON.stringify({
          eventId: event.id,
          groupId: event.groups[0]!.id,
        }));
        if (this.onNavigate) {
          this.onNavigate('event/detail', { source: 'pdf', title: event.title });
        }
      }
      return;
    }

    // 云比赛条目
    try {
      const history = await this.eventQuerier.queryHistory({ limit: 20 }) ?? [];
      const entry = history.find(h => h.id === id);
      if (entry && this.onNavigate) {
        this.onNavigate('event/detail', {
          eventId: String(entry.eventId),
          title: entry.title,
        });
      }
    } catch { /* ignore */ }
  }

  private async queryEvents(area: string, month: number, keyword: string): Promise<void> {
    this.area = area;
    this.month = month;
    // 记住选择的省份
    try {
      if (area) {
        await this.storage.write(STORAGE_KEY_AREA, area);
      } else {
        await this.storage.delete(STORAGE_KEY_AREA);
      }
    } catch { /* ignore */ }

    this.renderer.showLoading();
    try {
      const result = await this.eventQuerier.queryEvents({ area, month, keyword });
      console.info('查询比赛', { area, month, keyword, count: result.total });
      if (this.onNavigate) {
        this.onNavigate('event/list', { area, month: String(month), keyword });
      }
    } catch (error) {
      console.error('查询比赛失败', error as Error);
      this.renderer.toast.error('查询失败');
    } finally {
      this.renderer.hideLoading();
    }
  }

  // ===== PDF 导入逻辑 =====

  private async handleImportFiles(files: File[]): Promise<void> {
    if (files.length === 1) {
      await this.handleImportFile(files[0]!);
      return;
    }

    const total = files.length;
    let success = 0, failed = 0;

    for (let i = 0; i < total; i++) {
      this.renderer.renderImportProgress(i, total, files[i]!.name);
      try {
        await this.handleImportFile(files[i]!, true);
        success++;
      } catch (e) {
        failed++;
        console.warn('导入失败', files[i]!.name, e as Error);
      }
    }

    this.renderer.renderImportDone(success, failed, total);
    this.switchTab('recent');
  }

  private async handleImportFile(file: File, silent: boolean = false): Promise<void> {
    try {
      if (!silent) this.renderer.toast.show('正在解析对阵表...');

      const arrayBuffer = await file.arrayBuffer();
      const result = await this.pdfParser.parse(arrayBuffer);

      if (result.matches.length === 0) {
        this.renderer.toast.error('未从 PDF 中提取到对阵数据');
        return;
      }

      const title = result.title || this.extractTitleFromFilename(file.name);
      const groupName = result.groupName || '默认组';
      const round = this.inferRound(result) ?? await this.guessNextRound(title, groupName);

      const pdfScores = this.buildPdfScores(result.matches);
      const playerIdMap = await this.buildPlayerIdMap(title, groupName);

      const matches = result.matches.map((m, idx) => ({
        bout: round,
        table: m.table ?? idx + 1,
        p1Id: playerIdMap.get(m.blackName) ?? m.blackNo ?? 0,
        p1Name: m.blackName,
        p1Score: m.blackScore,
        p2Id: m.whiteName ? (playerIdMap.get(m.whiteName) ?? m.whiteNo ?? 0) : 0,
        p2Name: m.whiteName,
        p2Score: m.whiteScore,
      }));

      await this.pdfService.importRound(title, groupName, round, matches, pdfScores);

      const event = await this.pdfService.findEvent(title);
      if (event) {
        const group = event.groups.find(g => g.name === groupName);
        if (group) {
          this.recalcWinLoss(group);
          await this.pdfService.saveEvent(event);
        }
      }

      if (!silent) {
        this.renderer.toast.success(`${title} / ${groupName} / 第${round}轮 / ${matches.length}场对阵`);
        this.switchTab('recent');
      }
    } catch (e) {
      console.error('PDF 解析失败', e as Error);
      this.renderer.toast.error('PDF 解析失败: ' + (e as Error).message);
    }
  }

  private buildPdfScores(pdfMatches: PdfMatch[]): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const m of pdfMatches) {
      if (m.blackName) scores[m.blackName] = m.blackScore;
      if (m.whiteName) scores[m.whiteName] = m.whiteScore;
    }
    return scores;
  }

  private recalcWinLoss(group: { rounds: Array<{ round: number; matches: Match[]; pdfScores: Record<string, number> }> }): void {
    const rounds = group.rounds.sort((a, b) => a.round - b.round);
    if (rounds.length === 0) return;

    const allPlayerNames = new Set<string>();
    for (const r of rounds) {
      for (const m of r.matches) {
        if (m.p1Name) allPlayerNames.add(m.p1Name);
        if (m.p2Name) allPlayerNames.add(m.p2Name);
      }
      for (const name of Object.keys(r.pdfScores)) {
        allPlayerNames.add(name);
      }
    }

    for (let i = 0; i < rounds.length - 1; i++) {
      const curRound = rounds[i]!;
      const nextPdfScores = rounds[i + 1]!.pdfScores;

      for (const m of curRound.matches) {
        const nextP1 = nextPdfScores[m.p1Name] ?? 0;
        const nextP2 = nextPdfScores[m.p2Name] ?? 0;
        const curP1 = curRound.pdfScores[m.p1Name] ?? 0;
        const curP2 = curRound.pdfScores[m.p2Name] ?? 0;
        m.p1Score = this.deltaToWinLoss(nextP1 - curP1);
        m.p2Score = this.deltaToWinLoss(nextP2 - curP2);
      }

      const matchPlayerNames = new Set<string>();
      for (const m of curRound.matches) {
        if (m.p1Name) matchPlayerNames.add(m.p1Name);
        if (m.p2Name) matchPlayerNames.add(m.p2Name);
      }
      for (const name of allPlayerNames) {
        if (matchPlayerNames.has(name)) continue;
        const curScore = curRound.pdfScores[name] ?? 0;
        const nextScore = nextPdfScores[name] ?? 0;
        const delta = nextScore - curScore;
        if (delta > 0) {
          const existingId = this.findPlayerId(rounds, name);
          curRound.matches.push({
            bout: curRound.round,
            table: curRound.matches.length + 1,
            p1Id: existingId,
            p1Name: name,
            p1Score: this.deltaToWinLoss(delta),
            p2Id: 0,
            p2Name: '',
            p2Score: 0,
          });
        }
      }
    }

    const lastRound = rounds[rounds.length - 1]!;
    for (const m of lastRound.matches) {
      m.p1Score = 0;
      m.p2Score = 0;
    }
  }

  private async buildPlayerIdMap(title: string, groupName: string): Promise<Map<string, number>> {
    const idMap = new Map<string, number>();
    const event = await this.pdfService.findEvent(title);
    if (!event) return idMap;
    const group = event.groups.find(g => g.name === groupName);
    if (!group) return idMap;
    for (const r of group.rounds) {
      for (const m of r.matches) {
        if (m.p1Name && m.p1Id && !idMap.has(m.p1Name)) idMap.set(m.p1Name, m.p1Id);
        if (m.p2Name && m.p2Id && !idMap.has(m.p2Name)) idMap.set(m.p2Name, m.p2Id);
      }
    }
    let fakeId = -1;
    for (const r of group.rounds) {
      for (const m of r.matches) {
        for (const name of [m.p1Name, m.p2Name]) {
          if (name && !idMap.has(name)) {
            idMap.set(name, fakeId--);
          }
        }
      }
    }
    return idMap;
  }

  private deltaToWinLoss(delta: number): number {
    if (delta >= WIN) return WIN;
    if (delta === DRAW) return DRAW;
    return LOSS;
  }

  private findPlayerId(rounds: Array<{ matches: Match[] }>, name: string): number {
    for (const r of rounds) {
      for (const m of r.matches) {
        if (m.p1Name === name && m.p1Id) return m.p1Id;
        if (m.p2Name === name && m.p2Id) return m.p2Id;
      }
    }
    return -1;
  }

  private extractTitleFromFilename(filename: string): string {
    return filename
      .replace(/\.pdf$/i, '')
      .replace(/[第]\d+轮.*/, '')
      .replace(/对阵表|编排表|比赛表/g, '')
      .trim() || '未命名比赛';
  }

  private inferRound(result: { roundLabel?: string }): number | null {
    if (result.roundLabel) {
      const m = result.roundLabel.match(/(\d+)/);
      if (m) return +m[1]!;
    }
    return null;
  }

  private async guessNextRound(title: string, groupName: string): Promise<number> {
    const event = await this.pdfService.findEvent(title);
    if (!event) return 1;
    const group = event.groups.find(g => g.name === groupName);
    if (!group || group.rounds.length === 0) return 1;
    return Math.max(...group.rounds.map(r => r.round)) + 1;
  }

  render(): void { this.renderer.render(); }

  async triggerQuery(): Promise<void> {
    await this.queryEvents(this.area, this.month, this.keyword);
  }

  destroy(): void {
    this.renderer.destroy();
    this.initialized = false;
  }
}
