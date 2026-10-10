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
import { PuzzlePageUI } from './ui/PuzzlePageUI';
import { PuzzleSolveHandler } from './handlers/PuzzleSolveHandler';
import { PuzzleStudyHandler } from './handlers/PuzzleStudyHandler';
import { PuzzleFilterDialog } from './ui/PuzzleFilterDialog';
import { PuzzleHistoryPanel } from './ui/PuzzleHistoryPanel';
import type { PuzzleInitialStone } from '../../../../../application/puzzle/PuzzleHistoryManager';
import { Select } from '@ui';

/** 在线来源每批拉取的题目数（只取一页，避免换题时反复翻页） */
const ONLINE_BATCH = 20;
/**
 * 内置题库单次加载上限
 * 题库实为 1800 题，全量解析 PW 标签较慢，故截断；筛选题型时命中数通常远低于上限，
 * 计数精确；不筛选时达到上限，UI 以 "600+" 提示真实总数更多。
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
  /** 当前来源/筛选关键字 */
  private source: PuzzleSource = DEFAULT_PUZZLE_SOURCE;
  private keyword = '';
  /** 来源与筛选偏好（localStorage 持久化，刷新后恢复） */
  private readonly preferences = new PuzzlePreferences();

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
      await this.loadPuzzleByUrl(p['url'], p['title'] ?? '', p['tag'] ?? '');
      return;
    }

    if (p['keyword']) {
      this.keyword = p['keyword'];
      this.ui.setKeyword(this.keyword);
    }
    this.applySourceUiState();
    await this.loadPuzzleList();
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
    document.getElementById('next-btn')?.addEventListener('click', () => void this.nextPuzzle());

    // 历史面板（滚动加载，无翻页按钮）
    document.getElementById('clear-btn')?.addEventListener('click', () => void this.historyPanel.clearHistory());

    // 正解弹框：研究 / 换题
    document.getElementById('solved-next-btn')?.addEventListener('click', () => {
      this.ui.hideModal('solved-modal');
      void this.nextPuzzle();
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
      void this.nextPuzzle();
    });

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
      this.currentIndex = -1;
      // 内置题库随机出题
      if (isLib) this.shuffleItems();
      this.ui.setLoading(false);
      // 回填筛选出的题目总数；达到单次加载上限时加 "+"（真实总数可能更多）
      this.ui.setKeyword(this.keyword, this.items.length, this.items.length >= count);
      if (this.items.length === 0) {
        if (refill) this.ui.showEmpty('没有更多题目了', '试试切换来源或调整筛选');
        else this.ui.showEmpty('没有符合条件的题目', isLib ? '试试调整题型或难度筛选' : '试试切换题目来源');
        return;
      }
      await this.nextPuzzle();
    } catch (e) {
      this.ui.setLoading(false);
      console.error('[PuzzlePage] 加载题库失败', e);
      this.ui.showEmpty('加载失败', e instanceof Error ? e.message : String(e));
    }
  }

  /** Fisher-Yates 原地随机打乱题目顺序 */
  private shuffleItems(): void {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j]!, this.items[i]!];
    }
  }

  /** 换一题（按顺序取下一题；用尽后在线来源续拉一批） */
  private async nextPuzzle(): Promise<void> {
    if (this.state.get('singlePuzzle')) return;
    if (this.items.length === 0) return;
    this.currentIndex++;
    if (this.currentIndex >= this.items.length) {
      // 内置题库已全量加载，回到开头再来一轮
      if (this.source === 'lib-life-death') {
        this.currentIndex = 0;
        this.shuffleItems();
      } else {
        await this.loadPuzzleList(true);
        return;
      }
    }
    const item = this.items[this.currentIndex]!;
    await this.loadPuzzleByUrl(item.url, item.title, item.subtitle ?? '');
  }

  /** 按 URL 加载题目 */
  private async loadPuzzleByUrl(url: string, title: string, tag: string): Promise<void> {
    this.ui.setLoading(true, '加载题目...');
    try {
      const fetched = await this.config.puzzleApp.fetchPuzzle(url);
      if (!fetched || !fetched.sgfContent) {
        this.ui.setLoading(false);
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
        this.ui.showEmpty('这不是一道题', '该题没有可判定的正解分支');
        return;
      }
      this.state.set('firstPlayer', this.detectFirstPlayer());

      // 棋盘尺寸适配
      const size = (data.board_size as 9 | 13 | 19) || 19;
      this.board.initialize({ size, showCoordinates: true, showMoveNumbers: false });

      this.ui.setLoading(false);
      this.ui.hideEmpty();
      this.startSolve();
      // 记录初始局面（AB/AW 摆子），供历史缩略图使用
      this.currentBoardSize = size;
      this.initialStones = this.captureInitialStones(size);
      this.hasRecordedAttempt = false;
    } catch (e) {
      this.ui.setLoading(false);
      console.error('[PuzzlePage] 加载题目失败', e);
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
    }).then(() => this.historyPanel.loadHistory());
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
    }).then(() => this.historyPanel.loadHistory());
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
    if (!replayData) return;
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
