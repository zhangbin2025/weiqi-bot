/**
 * 做题页面
 * @module presentation/adapters/web/pages/puzzle/PuzzlePage
 * @description 支持内置题库与在线题库（101 / GoProblems / OGS）的做题页面。
 *              交替落子对战 + 研究模式（看答案/选点导航）+ 做题历史。
 *              默认答题模式不显示答案，仅在研究模式或解出后才展示选点导航。
 */
import { WebBoard } from '../../components/Board';
import { Game } from '../../../../../domain/game';
import { sgfToReplayData, buildTsumegoMinBoard } from '../../../../../domain/sgf';
import { BoardRebuilder } from '../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import { TsumegoChecker } from '../../../../core/helpers/TsumegoChecker';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { IAudioPlayer } from '../../../../../infrastructure/audio/IAudioPlayer';
import type { ReplayData } from '../../../../../domain/sgf';
import type { PuzzleApp, PuzzleItem, PuzzleSource } from '../../../../../application/puzzle/PuzzleApp';
import { PUZZLE_SOURCE_LABELS, DEFAULT_PUZZLE_SOURCE } from '../../../../../application/puzzle/PuzzleApp';
import { PuzzlePageState, PuzzleMode } from './state/PuzzlePageState';
import { PuzzlePreferences } from './state/PuzzlePreferences';
import { PuzzleSessionStore } from './state/PuzzleSessionStore';
import { PuzzlePageUI } from './ui/PuzzlePageUI';
import { PuzzleSolveHandler } from './handlers/PuzzleSolveHandler';
import { PuzzleStudyHandler } from './handlers/PuzzleStudyHandler';
import { PuzzleFilterDialog } from './ui/PuzzleFilterDialog';
import { PuzzleHistoryPanel } from './ui/PuzzleHistoryPanel';
import { PuzzleStatsDialog } from './ui/PuzzleStatsDialog';
import type { PuzzleInitialStone } from '../../../../../application/puzzle/PuzzleHistoryManager';
import { Select } from '@ui';

/** 在线来源每批拉取的题目数（只取一页，避免换题时反复翻页） */
const ONLINE_BATCH = 20;
/**
 * 内置题库请求条数（实为「不限」）
 * @description FetcherApp 对内置题库忽略该值、返回筛选后的全量（列表走 meta 索引，
 *              很便宜），故 items.length 即真实总数、计数精确，不加 "+"。
 *              保留该常量仅为对齐 listPuzzles 签名语义。
 */
const LIB_BATCH = 600;

/** 选点字母标签（按棋盘扫描序分配 A/B/C/D…） */
const CHOICE_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 页面配置 */
export interface PuzzlePageConfig {
  puzzleApp: PuzzleApp;
  audioPlayer?: IAudioPlayer | undefined;
  onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
}

/** 来源下拉选项 */
const SOURCE_OPTIONS = (Object.keys(PUZZLE_SOURCE_LABELS) as PuzzleSource[]).map((s) => ({
  value: s,
  label: PUZZLE_SOURCE_LABELS[s],
}));

/** 做题页面 */
export class PuzzlePage implements IPage {
  readonly title = '做题';

  private state: PuzzlePageState;
  private ui: PuzzlePageUI;
  private solveHandler: PuzzleSolveHandler;
  private studyHandler: PuzzleStudyHandler;
  private historyPanel: PuzzleHistoryPanel;

  private board: WebBoard;
  private game: Game;
  private checker: TsumegoChecker;
  private audioPlayer?: IAudioPlayer | undefined;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;

  /** 当前题目初始局面摆子（用于历史缩略图） */
  private initialStones: PuzzleInitialStone[] = [];
  /** 当前题目棋盘路数 */
  private currentBoardSize = 19;
  /** 本题是否已记入历史（避免每次落子重复写） */
  private hasRecordedAttempt = false;

  /** 当前题库条目（用于换题） */
  private items: PuzzleItem[] = [];
  private currentIndex = -1;
  /** items 对应的来源/筛选条件，用于判断缓存是否仍匹配当前设置 */
  private itemsSource: PuzzleSource | '' = '';
  private itemsKeyword = '';
  /** items 是否达到单次加载上限（决定题数是否显示 "+"） */
  private itemsCapped = false;
  /**
   * 当前筛选条件下的已做题数（由做题历史统计）
   * undefined = 尚未算完或不适用（在线来源），此时 UI 只显示总数
   */
  private itemsDone: number | undefined = undefined;
  /**
   * 已做数统计的竞态守卫（自增序号）
   * @description 连续切换筛选时，先发的异步统计可能后返回；
   *              只认最后一次发起的那次结果，避免旧数字盖掉新数字。
   */
  private doneSeq = 0;
  /**
   * items 中每条在本轮已被出过的轮次号
   * 内置题库一轮内不重复出题；用尽后 cycle+1 重洗，允许再来一轮
   */
  private usedCycle: number[] = [];
  private cycle = 0;
  /** 在线来源续拉取锁，避免批次用尽时反复续拉 */
  private refilling = false;
  /** 当前来源/筛选关键字 */
  private source: PuzzleSource = DEFAULT_PUZZLE_SOURCE;
  private keyword = '';
  /** 来源与筛选偏好（localStorage 持久化，刷新后恢复） */
  private readonly preferences = new PuzzlePreferences();
  /**
   * 做题会话状态（sessionStorage 持久化）
   * 跳打谱页看棋谱后返回时，靠它把用户送回原来那道题，而不是随机换一道
   */
  private readonly sessionStore = new PuzzleSessionStore();
  /** 本次页面加载是否已从会话缓存恢复过（避免重复恢复） */
  private restoredFromSession = false;

  constructor(private config: PuzzlePageConfig) {
    this.state = new PuzzlePageState();
    this.board = new WebBoard(document.getElementById('board-container') ?? undefined);
    this.game = new Game();
    this.checker = new TsumegoChecker();
    this.audioPlayer = config.audioPlayer;
    this.onNavigate = config.onNavigate;

    this.ui = new PuzzlePageUI(this.state);
    this.solveHandler = new PuzzleSolveHandler({
      state: this.state,
      ui: this.ui,
      game: this.game,
      board: this.board,
      checker: this.checker,
      playSound: (t) => this.playSound(t),
    });
    this.studyHandler = new PuzzleStudyHandler({
      state: this.state,
      ui: this.ui,
      game: this.game,
      board: this.board,
      checker: this.checker,
      playSound: (t) => this.playSound(t),
    });
    this.historyPanel = new PuzzleHistoryPanel({
      puzzleApp: config.puzzleApp,
      onOpenPuzzle: (entry) => this.openHistoryPuzzle(entry),
    });
  }

  // ==================== 初始化 ====================

  async initialize(): Promise<void> {
    if (this.state.get('initialized')) return;

    // 挂载下拉框
    Select.mountAll();

    // 棋盘（构造时已挂载到 #board-container）
    this.board.initialize({ size: 19, showCoordinates: true, showMoveNumbers: false });
    this.board.on({
      onClick: (pos) => this.handleBoardClick(pos.x, pos.y),
      onHover: (pos) => this.handleBoardHover(pos),
    });

    this.bindEvents();
    await this.historyPanel.loadHistory();

    // 恢复上次来源与筛选条件（刷新后按上次条件出题）
    await this.preferences.load();
    this.source = this.preferences.getSource();
    Select.get('#source-select')?.setValue(this.source, true);
    this.keyword = this.preferences.resolveKeyword();
    this.ui.setKeyword(this.keyword);
    // 恢复选点显示偏好（刷新后保持上次的开关状态）
    this.state.set('showChoices', this.preferences.getShowChoices());

    this.state.set('initialized', true);
  }

  /** 从 URL 参数加载 */
  async handleParams(params: PageParams): Promise<void> {
    const p = params as Record<string, string>;
    if (p['source'] && PUZZLE_SOURCE_LABELS[p['source'] as PuzzleSource]) {
      // 显式来源（fetcher 跳转）覆盖偏好并落盘，刷新后仍停留在该来源
      this.source = p['source'] as PuzzleSource;
      this.preferences.setSource(this.source);
    }
    Select.get('#source-select')?.setValue(this.source, true);
    // 筛选条件只在来源确定后生效：内置题库用偏好条件，其他来源清空
    this.keyword = this.preferences.resolveKeyword();
    this.ui.setKeyword(this.keyword);

    // 单题模式：从 fetcher 跳过来只做这一道题
    // 禁用换题、筛选、来源切换，只能看来源
    if (p['url']) {
      this.state.set('singlePuzzle', true);
      Select.get('#source-select')?.setDisabled(true);
      this.applySourceUiState();
      // 深链是「用户主动指定的那道题」，优先级高于上次会话缓存：
      // 先清掉缓存，避免被旧题覆盖（loadPuzzleByUrl 会重新写入本题）
      this.sessionStore.clearCurrent();
      this.restoredFromSession = true;
      await this.loadPuzzleByUrl(p['url'], p['title'] ?? '', p['tag'] ?? '');
      return;
    }

    if (p['keyword']) {
      this.keyword = p['keyword'];
      this.ui.setKeyword(this.keyword);
    }
    this.applySourceUiState();

    // 返回恢复优先：从打谱页（或任何整页返回）回来时，先试着回到刚才那道题。
    // 无缓存才走常规出题流程。单题模式 / 带 url 的深链已在上面处理，不走这里。
    if (await this.restoreFromSession()) return;

    await this.loadPuzzleList();
  }

  /**
   * 从会话缓存恢复上次做的那道题
   * @returns 命中缓存并成功恢复返回 true，否则 false
   * @description 只在「本次页面加载第一次进入」时生效，避免重复恢复。
   *              恢复内容含当前题目 + 题库进度，这样恢复后点「换题」能接着往下走。
   */
  private async restoreFromSession(): Promise<boolean> {
    if (this.restoredFromSession) return false;
    this.restoredFromSession = true;

    const current = await this.sessionStore.loadCurrent();
    if (!current) return false;

    // 先定来源：缓存来源可能与 localStorage 偏好不同（如从历史跳到了别的来源）
    this.source = current.source;
    Select.get('#source-select')?.setValue(this.source, true);
    // 来源既定，筛选关键字按新来源重解析（内置题库才应用筛选），
    // 避免把内置题库的筛选条件带到一个不支持筛选的在线来源上
    this.keyword = this.preferences.resolveKeyword(this.source);
    this.ui.setKeyword(this.keyword);

    // 再恢复题库进度：必须按解析后的 keyword 匹配，否则进度被判为失效
    const progress = await this.sessionStore.loadProgress(this.source, this.keyword);
    if (progress) {
      this.items = progress.items;
      this.currentIndex = progress.currentIndex;
      this.itemsSource = progress.itemsSource;
      this.itemsKeyword = progress.itemsKeyword;
      this.itemsCapped = progress.itemsCapped;
      this.usedCycle = progress.usedCycle;
      this.cycle = progress.cycle;
      this.ui.setKeyword(this.itemsKeyword, this.items.length, this.itemsCapped);
      // 缓存里没有已做数（sessionStore 不存），按恢复后的条件重算
      this.refreshDoneCount();
    }

    // 单题模式：从历史/fetcher 跳入的那道题，返回后必须仍是它
    if (current.singlePuzzle) {
      this.state.set('singlePuzzle', true);
      Select.get('#source-select')?.setDisabled(true);
    }
    this.applySourceUiState();

    await this.loadPuzzleByUrl(current.url, current.title, current.tag);
    return true;
  }

  render(): void {
    this.ui.updatePuzzleInfo(this.state);
    this.ui.updateControls(this.state, this.studyHandler.canUndo());
    this.renderHistoryPanel();
  }

  // ==================== 事件绑定 ====================

  private bindEvents(): void {
    // 标签页
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabId = (tab as HTMLElement).dataset['tab'];
        if (tabId === 'quiz' || tabId === 'history') this.switchTab(tabId);
      });
    });

    // 来源下拉
    Select.get('#source-select')?.onChange((v) => {
      this.source = v as PuzzleSource;
      this.preferences.setSource(this.source);
      // 内置题库恢复其筛选关键词；其他来源不应用筛选（条件本身保留在偏好里）
      this.keyword = this.preferences.resolveKeyword();
      // 换来源即作废上一次的已做数：它是按旧来源的条件算的
      this.doneSeq++;
      this.itemsDone = undefined;
      this.ui.setKeyword(this.keyword);
      this.applySourceUiState();
      void this.loadPuzzleList();
    });

    // 筛选按钮（仅内置题库可点）
    document.getElementById('filter-btn')?.addEventListener('click', () => {
      if (this.state.get('singlePuzzle')) return;
      if (this.source !== 'lib-life-death') return;
      PuzzleFilterDialog.open(
        () => this.preferences.getFilter(),
        (st) => {
          this.preferences.setFilter(st);
          // 全空表示不筛选，resolveKeyword 统一处理
          this.keyword = this.preferences.resolveKeyword();
          this.ui.setKeyword(this.keyword);
          void this.loadPuzzleList();
        },
      );
    });

    // 筛选行右侧的选点开关（答题模式显示 A/B/C/D 选点）
    document.getElementById('choices-btn')?.addEventListener('click', () => this.toggleChoices());

    // 控制按钮（棋盘下方一排图标）
    document.getElementById('undo-btn')?.addEventListener('click', () => this.studyUndo());
    document.getElementById('answer-btn')?.addEventListener('click', () => this.toggleAnswer());
    document.getElementById('next-btn')?.addEventListener('click', () => void this.requestNext());

    // 历史面板（滚动加载，无翻页按钮）
    document.getElementById('stats-btn')?.addEventListener('click', () => void this.openStatsDialog());
    document.getElementById('clear-btn')?.addEventListener('click', () => void this.historyPanel.clearHistory());

    // 正解弹框：研究 / 换题
    document.getElementById('solved-next-btn')?.addEventListener('click', () => {
      this.ui.hideModal('solved-modal');
      void this.requestNext();
    });
    document.getElementById('solved-study-btn')?.addEventListener('click', () => {
      this.ui.hideModal('solved-modal');
      this.enterStudy();
    });

    // 答错弹框：重做 / 研究 / 换题
    document.getElementById('wrong-restart-btn')?.addEventListener('click', () => {
      this.ui.hideModal('wrong-modal');
      this.restart();
    });
    document.getElementById('wrong-study-btn')?.addEventListener('click', () => {
      this.ui.hideModal('wrong-modal');
      this.enterStudy();
    });
    document.getElementById('wrong-next-btn')?.addEventListener('click', () => {
      this.ui.hideModal('wrong-modal');
      void this.requestNext();
    });

    // 弹框关闭：右上角关闭按钮 / 点击弹框外区域 / 按 Esc
    // 说明：只隐藏弹框，不改变当前答题或研究状态
    document.querySelectorAll<HTMLElement>('.puzzle-modal').forEach((modal) => {
      // 点在遮罩自身（内容区之外）才关闭
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.ui.hideModal(modal.id);
      });
      modal.querySelector<HTMLElement>('[data-modal-close]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ui.hideModal(modal.id);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      const open = document.querySelector<HTMLElement>('.puzzle-modal.show');
      if (open) this.ui.hideModal(open.id);
    });

    // 重做本题（重置当前题，重新计时并累加尝试次数）
    document.getElementById('restart-btn')?.addEventListener('click', () => this.restart());

    // 在打谱页查看本题棋谱
    document.getElementById('replay-btn')?.addEventListener('click', () => this.viewInReplay());

    // 返回
    document.getElementById('back-btn')?.addEventListener('click', () => {
      if (this.onNavigate) this.onNavigate('home');
      else window.history.back();
    });
  }

  /** 同步来源相关的 UI 状态（筛选按钮可用性） */
  private applySourceUiState(): void {
    const isLib = this.source === 'lib-life-death';
    const single = this.state.get('singlePuzzle');
    const filterBtn = document.getElementById('filter-btn') as HTMLButtonElement | null;
    if (filterBtn) filterBtn.disabled = !isLib || single;
  }

  /** 切换答题模式选点显示（写入偏好，刷新后保持） */
  private toggleChoices(): void {
    const next = !this.state.get('showChoices');
    this.state.set('showChoices', next);
    this.preferences.setShowChoices(next);
    this.syncChoicesButton();
    this.refresh();
  }

  /** 同步选点按钮外观（激活态 + 研究模式下禁用） */
  private syncChoicesButton(): void {
    const btn = document.getElementById('choices-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const studying = this.state.get('mode') === 'study';
    const hasData = !!this.state.get('replayData');
    btn.classList.toggle('active', this.state.get('showChoices') && !studying);
    btn.disabled = !hasData || studying;
    // 研究模式已有蓝/红选点导航，提示文案相应变化
    btn.title = studying ? '研究模式已显示正解/失败选点' : '显示选点（A/B/C/D）';
  }

  private switchTab(tab: 'quiz' | 'history'): void {
    document.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset['tab'] === tab);
    });
    document.getElementById('quiz-tab')?.classList.toggle('active', tab === 'quiz');
    document.getElementById('history-tab')?.classList.toggle('active', tab === 'history');
    if (tab === 'history') {
      void this.historyPanel.loadHistory().then(() => this.renderHistoryPanel());
    }
  }

  // ==================== 题目加载 ====================

  /**
   * 加载题目列表并载入第一题
   *
   * 内置题库一次性全量拉取（本地资源，无需分页）后随机打乱；
   * 在线来源只取一页（ONLINE_BATCH），避免换题时反复翻页导致卡顿。
   *
   * @param refill - 在线来源批次用尽后，续拉下一批
   */
  private async loadPuzzleList(refill = false): Promise<void> {
    this.ui.setLoading(true, '加载题库...');
    try {
      const isLib = this.source === 'lib-life-death';
      const count = isLib ? LIB_BATCH : ONLINE_BATCH;
      this.items = await this.config.puzzleApp.listPuzzles(this.source, count, this.keyword || undefined);
      this.itemsSource = this.source;
      this.itemsKeyword = this.keyword;
      // 内置题库：FetcherApp 对 lib 来源忽略 count（见 FetcherApp 注释「内置题库返回全量」），
      // items.length 就是筛选后的真实总数，永远是精确的，不该加 "+"。
      // 只有在线来源（按 ONLINE_BATCH 真正截断）才可能出现「真实总数更多」。
      this.itemsCapped = !isLib && this.items.length >= count;
      // 重置出题轮次：新一轮内每条只出一次
      this.cycle = 1;
      this.usedCycle = new Array(this.items.length).fill(0);
      this.currentIndex = -1;
      // 内置题库随机出题
      if (isLib) this.shuffleItems();
      // 打乱之后再存：缓存里的顺序必须与内存一致，
      // 否则恢复时 currentIndex 指向的是未打乱数组的下标 → 回到另一道题
      this.saveProgress();
      this.ui.setLoading(false);
      // 回填筛选出的题目总数；达到单次加载上限时加 "+"（真实总数可能更多）
      // 已做数先置 undefined 立即出总数，异步算完再补（见 refreshDoneCount）
      this.itemsDone = undefined;
      this.ui.setKeyword(this.keyword, this.items.length, this.itemsCapped);
      this.refreshDoneCount();
      if (this.items.length === 0) {
        // 筛不出题：必须把上一道题彻底清掉（状态 + 棋盘）。
        // 只显示空态而留着旧局面，用户会以为筛选没生效。
        this.clearPuzzleState();
        if (refill) this.ui.showEmpty('没有更多题目了', '试试切换来源或调整筛选');
        else this.ui.showEmpty('没有符合条件的题目', isLib ? '试试调整题型或难度筛选' : '试试切换题目来源');
        return;
      }
      await this.nextPuzzle();
    } catch (e) {
      this.ui.setLoading(false);
      console.error('[PuzzlePage] 加载题库失败', e);
      this.clearPuzzleState();
      this.ui.showEmpty('加载失败', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 统计并回填「已做」题数（仅内置题库）
   *
   * 异步执行：做题历史可能上千条，同步算会卡住列表渲染。
   * 完成后只在「来源/筛选条件未变」时回填，否则丢弃结果（用户已切走）。
   *
   * 在线来源不统计：其题目没有「类型·难度」标签，无法判断是否命中当前筛选，
   * 硬算只会得出一个与总数不同源的数字。
   */
  private refreshDoneCount(): void {
    if (this.source !== 'lib-life-death') { this.itemsDone = undefined; return; }
    const source = this.source;
    const keyword = this.keyword;
    const seq = ++this.doneSeq;
    void this.config.puzzleApp.countDone(keyword || undefined)
      .then((done) => {
        // 条件已变更（又切了筛选/来源）：结果作废
        if (seq !== this.doneSeq) return;
        if (this.source !== source || this.keyword !== keyword) return;
        this.itemsDone = done;
        this.ui.setKeyword(this.itemsKeyword, this.items.length, this.itemsCapped, done);
      })
      .catch((e) => {
        // 统计失败不影响做题：保持只显示总数
        console.warn('[PuzzlePage] 统计已做题数失败', e);
      });
  }

  /** Fisher-Yates 原地随机打乱题目顺序 */
  private shuffleItems(): void {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j]!, this.items[i]!];
    }
  }

  /**
   * 换一题
   *
   * 出题规则：
   * 1. 必须避开当前正在做的这道题——否则从单题模式退出后「点完还是这道题」
   * 2. 内置题库一轮内每条只出一次，用尽后 cycle+1 重洗再来一轮
   * 3. 在线来源批次用尽后续拉一批
   */
  private async nextPuzzle(): Promise<void> {
    if (this.state.get('singlePuzzle')) return;
    if (this.items.length === 0) return;

    // 刚看过的题目 URL：换题必须避开
    const avoidUrl = this.state.get('url');

    const pick = this.findNextIndex(avoidUrl);
    if (pick >= 0) {
      await this.takeIndex(pick);
      return;
    }

    // 本轮已用尽
    if (this.source !== 'lib-life-death') {
      // 在线来源续拉一批（refilling 防止递归续拉）
      if (this.refilling) return;
      this.refilling = true;
      try {
        await this.loadPuzzleList(true);
      } finally {
        this.refilling = false;
      }
      return;
    }

    if (this.items.length <= 1) {
      // 只有一题，无从避开，只能重出
      await this.takeIndex(0);
      return;
    }
    // 内置题库：开启新一轮，重洗后再挑（仍避开当前题）
    this.cycle++;
    this.shuffleItems();
    this.usedCycle = new Array(this.items.length).fill(0);
    this.currentIndex = -1;
    const again = this.findNextIndex(avoidUrl);
    await this.takeIndex(again >= 0 ? again : 0);
  }

  /** 从当前位置往后找「本轮未出过且不是 avoidUrl」的下标；找不到返回 -1 */
  private findNextIndex(avoidUrl: string): number {
    const n = this.items.length;
    if (n === 0) return -1;
    for (let k = 1; k <= n; k++) {
      const i = (this.currentIndex + k) % n;
      if (this.usedCycle[i] === this.cycle) continue;
      if (avoidUrl && this.items[i]!.url === avoidUrl) continue;
      return i;
    }
    return -1;
  }

  /** 取走指定下标的题目，并标记为本轮已出 */
  private async takeIndex(index: number): Promise<void> {
    this.currentIndex = index;
    this.usedCycle[index] = this.cycle;
    const item = this.items[index]!;
    // loadPuzzleByUrl 内部会写当前题目与进度，这里无需重复写
    await this.loadPuzzleByUrl(item.url, item.title, item.subtitle ?? '');
  }

  /** 保存题库进度到会话缓存（供返回时恢复「换题」的续推位置） */
  private saveProgress(): void {
    if (this.items.length === 0) return;
    this.sessionStore.saveProgress({
      items: this.items,
      currentIndex: this.currentIndex,
      itemsSource: this.itemsSource,
      itemsKeyword: this.itemsKeyword,
      itemsCapped: this.itemsCapped,
      usedCycle: this.usedCycle,
      cycle: this.cycle,
    });
  }

  /**
   * 退出单题模式，回到正常出题流程
   *
   * 单题模式原本服务于 fetcher 深链（?url=xxx），会锁死换题/筛选/来源。
   * 但历史条目是页内导航，用户本就在做题流程里，若沿用同一把锁就再无出口
   * ——只能刷新整页。故提供显式退出：清 flag、解锁来源与筛选、恢复筛选条件。
   */
  private exitSinglePuzzle(): void {
    if (!this.state.get('singlePuzzle')) return;
    this.state.set('singlePuzzle', false);
    Select.get('#source-select')?.setDisabled(false);
    // 单题模式已退出：会话缓存里的 singlePuzzle 标记同步失效，
    // 否则返回时又会被恢复成锁死的单题状态
    this.sessionStore.clearCurrent();
    // 退出后按当前来源重新解析筛选条件（内置题库用偏好，其他来源不筛）
    this.keyword = this.preferences.resolveKeyword();
    this.ui.setKeyword(this.keyword);
    // 题库缓存若与当前来源/筛选不匹配（如从历史跳到了别的来源），作废后重拉
    if (this.itemsSource !== this.source || this.itemsKeyword !== this.keyword) {
      this.items = [];
      this.itemsSource = '';
      this.itemsKeyword = '';
      this.itemsCapped = false;
      this.currentIndex = -1;
    } else if (this.items.length > 0) {
      // 缓存仍匹配：补回被单题模式清掉的题数
      this.ui.setKeyword(this.keyword, this.items.length, this.itemsCapped, this.itemsDone);
    }
    this.applySourceUiState();
  }

  /**
   * 清空当前题目相关的全部运行时状态（不碰偏好与来源）
   * @description 供 showEmpty 前调用，保证「没有题」时页面上是干净的空态，
   *              而不是旧题的局面 + 一行提示。棋盘本身由 showEmpty 负责隐藏。
   */
  private clearPuzzleState(): void {
    this.state.clearPuzzle();
    this.solveHandler.enterSolve();
    this.studyHandler.reset();
    this.checker.init(null);
    this.game.newGame({ size: 19 });
    this.board.clear();
    this.initialStones = [];
    // 阻止无题状态下的落子写历史（recordAttempt 靠 url 判空，这里是双保险）
    this.hasRecordedAttempt = true;
    this.refresh();
  }

  /**
   * 换一题（统一入口）
   *
   * 单题模式下先退出单题模式再换题——「换题」的语义就是不想做这道了，
   * 此时最自然的兑现是回题库给一道新题，而不是把用户锁死在详情页里。
   * 题库为空（如直接由 URL 参数进入并且尚未拉过列表）时先拉一批。
   */
  private async requestNext(): Promise<void> {
    this.exitSinglePuzzle();
    if (this.items.length === 0) {
      await this.loadPuzzleList();
      return;
    }
    await this.nextPuzzle();
  }

  /** 按 URL 加载题目 */
  private async loadPuzzleByUrl(url: string, title: string, tag: string): Promise<void> {
    this.ui.setLoading(true, '加载题目...');
    try {
      const fetched = await this.config.puzzleApp.fetchPuzzle(url);
      if (!fetched || !fetched.sgfContent) {
        this.ui.setLoading(false);
        this.clearPuzzleState();
        this.ui.showEmpty('题目加载失败', '请检查网络或更换题目来源');
        return;
      }
      // 死活题最小路数压缩（101/OGS/GoProblems 通用）
      const raw = fetched.sgfContent;
      const remapped = buildTsumegoMinBoard(raw);
      let sgf = raw;
      if (remapped) {
        const probe = sgfToReplayData(remapped.sgf);
        if (probe && (probe.board_size as number) === remapped.size) sgf = remapped.sgf;
      }
      const data = sgfToReplayData(sgf, { defaultMove: 0 });
      if (!data) {
        this.ui.setLoading(false);
        this.clearPuzzleState();
        this.ui.showEmpty('棋谱解析失败', '该题 SGF 无法解析');
        return;
      }

      this.state.set('sgfContent', sgf);
      // 归档ID：跳打谱页时按 archiveId 传递（抓题已写入历史归档）
      this.state.set('archiveId', fetched.archiveId ?? '');
      this.state.set('replayData', data);
      this.state.set('title', title);
      this.state.set('tag', tag);
      this.state.set('source', this.source);
      this.state.set('url', url);
      this.ui.hideModal('wrong-modal');
      this.ui.hideModal('solved-modal');
      this.state.resetForNewPuzzle();

      this.checker.init(data);
      if (!this.checker.getIsTsumego()) {
        this.ui.setLoading(false);
        this.clearPuzzleState();
        this.ui.showEmpty('这不是一道题', '该题没有可判定的正解分支');
        return;
      }
      this.state.set('firstPlayer', this.detectFirstPlayer());

      // 先收空态：hideEmpty 会恢复棋盘容器显示，必须早于 board.initialize。
      // 否则 initialize → render 时容器还是 display:none（clientWidth=0），
      // 画布会按尺寸下限 300 定死，恢复显示后棋盘偏小且要等下次重排才修正。
      this.ui.setLoading(false);
      this.ui.hideEmpty();

      // 棋盘尺寸适配
      const size = (data.board_size as 9 | 13 | 19) || 19;
      this.board.initialize({ size, showCoordinates: true, showMoveNumbers: false });

      this.startSolve();
      // 记录初始局面（AB/AW 摆子），供历史缩略图使用
      this.currentBoardSize = size;
      this.initialStones = this.captureInitialStones(size);
      this.hasRecordedAttempt = false;

      // 记住当前这道题：跳打谱页看棋谱后返回，要能回到这里而不是换一道
      this.sessionStore.saveCurrent({
        url,
        title,
        tag,
        source: this.source,
        singlePuzzle: this.state.get('singlePuzzle'),
      });
      this.saveProgress();
    } catch (e) {
      this.ui.setLoading(false);
      console.error('[PuzzlePage] 加载题目失败', e);
      this.clearPuzzleState();
      this.ui.showEmpty('加载失败', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 在打谱页查看本题棋谱
   * @description 按 archiveId 传递（与 fetcher 一致），打谱页自行从归档读 SGF，
   *              避免超长 SGF 塞进 URL。抓题时 GameService 已写入历史归档，
   *              故 archiveId 一般可用；归档不可用时按钮本身即为禁用态（见 updateControls）。
   *              优先走宿主导航（onNavigate），无宿主时直接拼 URL 兜底。
   */
  private viewInReplay(): void {
    const archiveId = this.state.get('archiveId');
    if (!archiveId) {
      console.warn('[PuzzlePage] 本题未归档，无法跳打谱页');
      return;
    }
    const params = { archiveId, move: '0' };
    if (this.onNavigate) {
      this.onNavigate('replay', params);
      return;
    }
    const query = new URLSearchParams(params).toString();
    window.location.href = `../replay/index.html?${query}`;
  }

  /**
   * 判定先手方：取首个正解分支的第一手颜色；
   * 无正解分支时回退到棋谱 initial_player
   */
  private detectFirstPlayer(): 'B' | 'W' {
    const correct = this.checker.getCorrectBranches();
    const first = correct.find((b) => b.moves.length > 0)?.moves[0];
    if (first) return first.color;
    const ip = this.state.get('replayData')?.initial_player;
    return ip === 'white' ? 'W' : 'B';
  }

  // ==================== 答题流程 ====================

  /**
   * 进入/重置答题，并重新开始计时
   * 计时口径：本次作答用时，重做或由研究切回答题都重新起算
   */
  private startSolve(): void {
    this.state.set('mode', 'solve');
    this.state.set('solved', false);
    this.state.set('startedAt', Date.now());
    // 新一轮作答可以再次写历史（管理层按 URL 累加次数）
    this.hasRecordedAttempt = false;
    this.solveHandler.enterSolve();
    this.ui.updateMode('solve');
    this.refresh();
  }

  /** 重做本题（attempts 累加，重新计时） */
  private restart(): void {
    this.ui.hideModal('wrong-modal');
    this.ui.hideModal('solved-modal');
    this.state.set('attempts', this.state.get('attempts') + 1);
    this.startSolve();
  }

  /** 看答案 / 切回答题 */
  private toggleAnswer(): void {
    if (this.state.get('mode') === 'study') {
      // 研究 → 答题：重新开始答题
      this.startSolve();
    } else {
      this.enterStudy();
    }
    this.refresh();
  }

  /**
   * 进入研究模式（看答案 + 选点导航全开）
   * 从 move 0 开始：不继承做题落子，回到题目初始局面
   */
  private enterStudy(): void {
    this.ui.hideModal('wrong-modal');
    this.ui.hideModal('solved-modal');
    this.state.set('mode', 'study');
    this.studyHandler.reset();
    this.ui.updateMode('study');
    this.refresh();
  }

  /** 研究模式回撤一手 */
  private studyUndo(): void {
    if (this.state.get('mode') !== 'study') return;
    if (!this.studyHandler.undo()) return;
    this.refresh();
  }

  /** 棋盘点击 */
  private handleBoardClick(x: number, y: number): void {
    if (this.state.get('loading')) return;
    if (!this.state.get('replayData')) return;

    if (this.state.get('mode') === 'study') {
      this.studyHandler.handleBoardClick(x, y);
    } else {
      const result = this.solveHandler.handleBoardClick(x, y);
      if (result === 'solved') this.onSolved();
      else if (result === 'wrong') {
        this.recordAttempt(false);
        this.playSound('wrong');
        this.ui.showWrongModal();
      }
      else if (result === 'placed') {
        // 落子即视为「做过」，先入历史（未解出），解出时再更新
        this.recordAttempt(false);
        this.playSound('stone');
      }
    }
    this.refresh();
  }

  /** 棋盘悬停预览 */
  private handleBoardHover(pos: { x: number; y: number } | null): void {
    if (pos === null) {
      this.board.clearPreviewStone();
      return;
    }
    if (this.game.getState().board.getStone(pos.x, pos.y) !== null) {
      this.board.clearPreviewStone();
      return;
    }
    // 答题模式已解出后不再预览；研究模式始终允许预览（自由试下）
    if (this.state.get('solved') && this.state.get('mode') !== 'study') {
      this.board.clearPreviewStone();
      return;
    }
    this.board.setPreviewStone(pos, this.game.getState().currentPlayer);
  }

  /** 解出回调 */
  private onSolved(): void {
    // 重复解出（如研究后切回答题再次走完）不再计时、不再重复记录
    if (this.state.get('solved')) return;
    this.ui.hideModal('wrong-modal');
    this.state.set('solved', true);
    this.playSound('correct');
    const startedAt = this.state.get('startedAt');
    const duration = startedAt > 0 ? Date.now() - startedAt : 0;
    this.hasRecordedAttempt = true;
    void this.config.puzzleApp.recordResult({
      url: this.state.get('url'),
      title: this.state.get('title'),
      source: this.state.get('source'),
      tag: this.state.get('tag'),
      success: true,
      attempts: this.state.get('attempts') + 1,
      moves: this.solveHandler.getUserMoveCount(),
      duration,
      boardSize: this.currentBoardSize,
      initialStones: this.initialStones,
    }).then(() => {
      void this.historyPanel.loadHistory();
      // 新做了一题：已做数可能 +1（若本题命中当前筛选）
      this.refreshDoneCount();
    });
    this.ui.showSolvedModal(duration);
  }

  /**
   * 记一次做题（未解出也会入历史，解出时再更新为已解出）
   * 同一题只写一次，避免每落一子都写历史
   */
  private recordAttempt(success: boolean): void {
    if (this.hasRecordedAttempt && !success) return;
    if (!this.state.get('url')) return;
    this.hasRecordedAttempt = true;
    const startedAt = this.state.get('startedAt');
    void this.config.puzzleApp.recordResult({
      url: this.state.get('url'),
      title: this.state.get('title'),
      source: this.state.get('source'),
      tag: this.state.get('tag'),
      success,
      attempts: 1,
      moves: this.solveHandler.getUserMoveCount(),
      duration: startedAt > 0 ? Date.now() - startedAt : 0,
      boardSize: this.currentBoardSize,
      initialStones: this.initialStones,
    }).then(() => {
      void this.historyPanel.loadHistory();
      this.refreshDoneCount();
    });
  }

  /** 采集棋盘上的初始摆子（用于历史缩略图） */
  private captureInitialStones(size: number): PuzzleInitialStone[] {
    const stones: PuzzleInitialStone[] = [];
    const board = this.game.getState().board;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = board.getStone(x, y);
        if (c === 'black' || c === 'white') stones.push({ x, y, color: c });
      }
    }
    return stones;
  }

  /** 从历史条目打开题目：等价于 fetcher 跳转的单题模式 */
  private openHistoryPuzzle(entry: { url: string; title: string; tag: string; source: string }): void {
    if (!entry.url) return;
    // 切回做题标签
    this.switchTab('quiz');
    this.state.set('singlePuzzle', true);
    Select.get('#source-select')?.setDisabled(true);
    // 来源与历史条目一致，保证下拉框显示正确
    const src = entry.source as PuzzleSource;
    if (src && PUZZLE_SOURCE_LABELS[src]) {
      this.source = src;
      Select.get('#source-select')?.setValue(src, true);
    }
    this.applySourceUiState();
    void this.loadPuzzleByUrl(entry.url, entry.title, entry.tag);
  }

  /** 刷新棋盘与 UI */
  private refresh(): void {
    const replayData = this.state.get('replayData') as ReplayData | null;
    if (!replayData) {
      // 无题状态（空态）：棋盘已由 showEmpty 隐藏，这里只需把按钮同步为「无题」态，
      // 不能提前 return —— 否则换题/看答案等按钮仍停留在上一题的可点状态。
      this.syncChoicesButton();
      this.ui.updatePuzzleInfo(this.state);
      this.ui.updateControls(this.state, this.studyHandler.canUndo());
      return;
    }
    // 做题页不显示手数（无手数开关 UI，且答题模式下暴露手数等于泄露答案进度）。
    // 固定传 false，让 BoardSyncer 走「高亮最后一手」分支：黑子中心白点、白子中心黑点。
    // 新开局未落子时 game.getState().lastMove 为 null，不会误标初始摆子。
    // 重建到初始局面：做题/研究都是「初始摆子 + 已落子」，无主线
    const moveNumbers = BoardRebuilder.rebuild(this.game, replayData, [], 0, {
      handicapStones: replayData.handicap_stones,
      initialPlayer: replayData.initial_player,
      inVariation: false,
    });
    // 重放当前已下的着法（用户 + 机器回应）
    const played = this.currentPlayedMoves();
    for (const m of played) this.game.placeStone(m.x, m.y);
    BoardSyncer.sync(this.board, this.game, moveNumbers, false);

    // 选点导航：仅研究模式下显示（答题模式不泄露答案）
    // 解出后答题模式也不显示，避免提前暴露其他分支
    if (this.state.get('mode') === 'study') {
      // 研究模式：蓝圈=正解 / 红圈=失败
      const cands = this.checker.getNextCandidates(
        played.map((m) => ({ ...m, color: m.color === 'B' ? 'black' : 'white' })),
        [],
      );
      this.board.clearChoices();
      this.board.setCandidates(cands.map((c) => ({
        x: c.x,
        y: c.y,
        kind: c.branchType === 'correct' ? 'correct' as const : 'wrong' as const,
      })));
    } else if (this.state.get('showChoices')) {
      // 答题模式：只标字母，不区分正误（颜色/形状均中性）
      // 按棋盘扫描序（上→下、左→右）分配字母，保证稳定且不让 A 恒为正解
      this.board.clearCandidates();
      const cands = this.checker.getNextCandidates(
        played.map((m) => ({ ...m, color: m.color === 'B' ? 'black' : 'white' })),
        [],
      );
      const sorted = [...cands].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      this.board.setChoices(sorted.map((c, i) => ({
        x: c.x,
        y: c.y,
        label: CHOICE_LABELS[i] ?? String(i + 1),
      })));
    } else {
      this.board.clearCandidates();
      this.board.clearChoices();
    }
    this.syncChoicesButton();

    this.ui.updatePuzzleInfo(this.state);
    this.ui.updateControls(this.state, this.studyHandler.canUndo());
  }

  /** 当前已落子列表（用户 + 机器回应，按顺序） */
  private currentPlayedMoves(): Array<{ x: number; y: number; color: 'B' | 'W' }> {
    return this.state.get('mode') === 'study'
      ? this.studyHandler.getMoves()
      : this.solveHandler.getMoves();
  }

  // ==================== 历史 ====================

  private renderHistoryPanel(): void {
    this.historyPanel.render();
  }

  /** 打开做题统计弹框（常规统计 + 棋力评估） */
  private async openStatsDialog(): Promise<void> {
    try {
      const report = await this.config.puzzleApp.getStrengthReport();
      PuzzleStatsDialog.open(report);
    } catch (e) {
      console.error('[PuzzlePage] 生成统计报告失败', e);
    }
  }

  // ==================== 工具 ====================

  private playSound(type: 'stone' | 'capture' | 'pass' | 'error' | 'correct' | 'wrong' | 'undo'): void {
    if (!this.state.get('soundEnabled')) return;
    void this.audioPlayer?.play(type);
  }

  destroy(): void {
    this.board.destroy();
  }
}

export { SOURCE_OPTIONS };
