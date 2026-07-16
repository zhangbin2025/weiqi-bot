/**
 * 对手分析页面控制器
 * @module presentation/pages/opponent/OpponentPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, IInput, ICard, ITabs, IToast, PageParams } from '../../../../core/interfaces';
import type {
  OpponentAnalyzer,
  OpponentAnalysisResult,
  OpponentAnalysisResultWithBookmark,
  OpponentGameInfo,
  OpponentHistoryEntry,
  OpponentBookmark,
} from '../../../../../application/opponent';
import type { IDiscoveredPattern } from '../../../../../services/joseki/discover/types';
import type { IReadMarkService } from '../../../../../services/readmark';
import { READ_MARK_CATEGORIES } from '../../../../../services/readmark/types';
/** 标签类型 */
type OpponentTab = 'query' | 'favorites';
/** 对手分析页面配置 */
export interface OpponentPageConfig {
  analyzer: OpponentAnalyzer;
  readMarkService: IReadMarkService;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
/** 对手分析页面 */
export class OpponentPage implements IPage {
  readonly title = '对手分析';
  private analyzer: OpponentAnalyzer;
  private readMarkService: IReadMarkService;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private input: IInput;
  private card: ICard;
  private tabs: ITabs;
  private toast: IToast;
  private currentTab: OpponentTab = 'query';
  private currentResult?: OpponentAnalysisResultWithBookmark | undefined;
  private history: OpponentHistoryEntry[] = [];
  private favorites: OpponentBookmark[] = [];
  private readMarkIds: string[] = [];
  private initialized = false;
  constructor(config: OpponentPageConfig) {
    this.analyzer = config.analyzer;
    this.readMarkService = config.readMarkService;
    this.onNavigate = config.onNavigate;
    this.input = AdapterFactory.createInput();
    this.card = AdapterFactory.createCard();
    this.tabs = AdapterFactory.createTabs();
    this.toast = AdapterFactory.createToast();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.tabs.setConfig({ items: [{ id: 'query', label: '查询' }, { id: 'favorites', label: '收藏' }] });
    this.tabs.setActiveId('query');
    this.tabs.onChange((id: string) => {
      this.switchTab(id === 'query' ? 'query' : 'favorites');
    });
    this.input.setConfig({ placeholder: '输入野狐ID' });
    this.input.onEnter((text) => this.analyze(text.trim()));
    this.initialized = true;
  }
  handleParams(params: PageParams): void {
    if (params['foxwqId']) {
      this.input.setValue(params['foxwqId']);
      this.analyze(params['foxwqId']);
    }
  }
  /** 切换标签 */
  async switchTab(tab: OpponentTab): Promise<void> {
    this.currentTab = tab;
    if (tab === 'favorites') {
      await this.loadFavorites();
    }
    this.render();
  }
  /** 加载收藏列表 */
  private async loadFavorites(): Promise<void> {
    try {
      this.favorites = await this.analyzer.getFavorites();
      this.render();  // 成功加载后需要渲染
    } catch (error) {
      console.error('加载收藏失败', error as Error);
      this.favorites = [];
      this.render();
    }
  }
  /** 清除收藏 */
  async clearFavorites(): Promise<void> {
    await this.analyzer.clearFavorites();
    this.favorites = [];
    this.toast.success('收藏已清除');
    this.render();
  }
  /** 查看收藏详情 */
  viewFavorite(foxwqId: string): void {
    const bookmark = this.favorites.find((f) => f.foxwqId === foxwqId);
    if (bookmark && bookmark.games) {
      // 从收藏数据构造 currentResult
      this.currentResult = {
        foxwqId: bookmark.foxwqId,
        userInfo: { uid: bookmark.foxwqId, nickname: bookmark.foxwqId },
        games: bookmark.games,
        joseki: bookmark.joseki || { count: 0, patterns: [] },
        analyzedAt: bookmark.analyzedAt || Date.now(),
      };
      this.switchTab('query');
      this.toast.success('已加载收藏分析');
    }
  }
  /** 加载历史（兼容旧数据） */
  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.analyzer.queryHistory({ limit: 20 });
      this.readMarkIds = await this.readMarkService.getReadMarks(
        READ_MARK_CATEGORIES.OPPONENT_GAMES
      );
    } catch (error) {
      console.error('加载历史失败', error as Error);
      this.history = [];
    }
  }
  /** 分析对手 */
  private async analyze(foxwqId: string): Promise<void> {
    if (!foxwqId) {
      this.toast.warning('请输入野狐ID');
      return;
    }
    this.toast.info(`正在分析 ${foxwqId}...`);
    this.input.clear();
    try {
      const result = await this.analyzer.analyze(foxwqId, {
        maxGames: 20,
        onProgress: (percent, status, detail) => {
          this.updateProgress(percent, status, detail);
        },
      });
      this.currentResult = result;
      this.toast.success('分析完成');
      this.render();
      console.info('对手分析完成', { foxwqId, gamesCount: result.games.length });
    } catch (error) {
      console.error('分析失败', error as Error);
      this.toast.error('分析失败');
    }
  }
  /** 更新进度显示 */
  private updateProgress(percent: number, status: string, detail?: string): void {
    this.card.setContent(
      [
        `${percent}%`,
        status,
        detail ?? '',
      ].join('\n')
    );
    this.card.render();
  }
  /** 清除历史已读标记 */
  async clearHistoryReadMarks(): Promise<void> {
    await this.readMarkService.clearReadMarks(READ_MARK_CATEGORIES.OPPONENT_GAMES);
    this.readMarkIds = [];
    this.toast.success('已读标记已清除');
    this.render();
  }
  /** 查看历史详情 */
  async viewHistory(id: string): Promise<void> {
    const entry = await this.analyzer.getHistoryDetail(id);
    if (!entry) {
      this.toast.warning('记录不存在');
      return;
    }
    await this.readMarkService.markRead(READ_MARK_CATEGORIES.OPPONENT_GAMES, id);
    this.readMarkIds.push(id);
    // getHistoryDetail 返回 OpponentAnalysisResult，需要转换为 OpponentAnalysisResultWithBookmark
    this.currentResult = { ...entry };
    await this.switchTab('query');
    this.toast.success('已加载历史分析');
  }
  /** 查看棋谱列表 */
  viewGames(): void {
    if (!this.currentResult?.games?.length) {
      this.toast.warning('无棋谱数据');
      return;
    }
    if (this.onNavigate) {
      this.onNavigate('games', {
        source: 'opponent',
        title: `${this.currentResult.foxwqId} 的棋谱`,
        gamesJson: JSON.stringify(
          this.currentResult.games.map((g) => ({
            id: g.chessid,
            black: g.black,
            white: g.white,
            date: g.date,
            result: g.result,
            sgf: g.sgf,
          }))
        ),
      });
    }
  }
  /** 查看定式规律 */
  viewJoseki(): void {
    if (!this.currentResult?.joseki?.patterns?.length) {
      this.toast.warning('无定式数据');
      return;
    }
    if (this.onNavigate) {
      const games = this.currentResult.games || [];
      this.onNavigate('joseki', {
        source: 'opponent',
        title: `${this.currentResult.foxwqId} 的定式`,
        patternsJson: JSON.stringify(
          this.currentResult.joseki.patterns.map((p, i) => {
            // 尝试从 games 中找到对应的完整棋谱
            const matchingGame = games.find(g => 
              p.gameInfo && 
              g.black === p.gameInfo.black &&
              g.white === p.gameInfo.white
            );
            return {
              id: `${this.currentResult!.foxwqId}-joseki-${i}`,
              prefix: p.prefix,
              prefixLen: p.prefixLen ?? p.prefix.split(/\s+/).length,
              totalMoves: p.totalMoves ?? 0,
              frequency: p.frequency,
              probability: p.probability ?? 0,
              winrateStats: { delta: p.winrateDelta ?? 0 },
              extractedMoves: p.extractedMoves,
              gameInfo: p.gameInfo,
              sourceCorner: p.sourceCorner,
              sgf: matchingGame?.sgf,
            };
          })
        ),
      });
    }
  }
  render(): void {
    this.input.render();
    this.tabs.render();
    if (this.currentTab === 'query') {
      this.renderQuery();
    } else {
      this.renderHistory();
    }
  }
  private renderQuery(): void {
    if (!this.currentResult) {
      this.card.setContent('输入野狐ID开始分析');
      this.card.render();
      return;
    }
    const gamesCount = this.currentResult.games?.length ?? 0;
    const josekiCount = this.currentResult.joseki?.count ?? 0;
    const isBookmarked = !!this.currentResult.bookmarkId;
    const lines = [
      `对手: ${this.currentResult.foxwqId}`,
      `棋谱数: ${gamesCount}`,
      `定式规律: ${josekiCount}`,
      isBookmarked ? '★ 已收藏' : '',
      '',
      '操作:',
      '  输入 "games" 查看棋谱列表',
      '  输入 "joseki" 查看定式规律',
    ].filter(Boolean);
    this.card.setContent(lines.join('\n'));
    this.card.render();
  }
  private renderHistory(): void {
    // 优先显示收藏列表
    if (this.favorites.length > 0) {
      const content = this.favorites.map((bookmark, index) => {
        const gamesCount = bookmark.games?.length ?? 0;
        const patternsCount = bookmark.joseki?.count ?? 0;
        const time = new Date(bookmark.updatedAt).toLocaleString();
        return `★ ${index + 1}. ${bookmark.foxwqId}\n   ${time} · ${gamesCount}局 · ${patternsCount}定式`;
      }).join('\n\n');
      this.card.setContent(`共 ${this.favorites.length} 条收藏\n\n${content}`);
      this.card.render();
      return;
    }
    // 兼容旧历史记录
    if (this.history.length === 0) {
      this.card.setContent('暂无收藏\n\n分析对手后会显示在这里');
      this.card.render();
      return;
    }
    const content = this.history.map((entry, index) => {
      const isRead = this.readMarkIds.includes(entry.id);
      const mark = isRead ? '○' : '●';
      const time = new Date(entry.analyzedAt).toLocaleString();
      return `${mark} ${index + 1}. ${entry.foxwqId}\n   ${time} · ${entry.gamesCount}局`;
    }).join('\n\n');
    this.card.setContent(`共 ${this.history.length} 条记录\n\n${content}`);
    this.card.render();
  }
  destroy(): void {
    this.input.destroy();
    this.card.destroy();
    this.tabs.destroy();
    this.toast.destroy();
    this.currentResult = undefined;
    this.history = [];
    this.readMarkIds = [];
    this.initialized = false;
  }
}
