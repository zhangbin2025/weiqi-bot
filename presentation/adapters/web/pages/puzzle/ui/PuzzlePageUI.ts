/**
 * 做题页面 UI 辅助
 * @description 负责 DOM 更新：题目信息、按钮状态、遮罩、空态、结果弹框、提示
 */
import type { PuzzlePageState } from '../state/PuzzlePageState';
import type { PuzzleMode } from '../state/PuzzlePageState';

/** 做题页面 UI 辅助类 */
export class PuzzlePageUI {
  constructor(private state: PuzzlePageState) {}

  /**
   * 更新题目信息（棋盘下方一行文字）
   * 规则：先手必显示（黑白棋子图标 + 文字，非常醒目）；有题型显示题型；有题号显示题号；来源不显示（上方下拉框已表明）
   */
  updatePuzzleInfo(state: PuzzlePageState): void {
    const el = document.getElementById('puzzle-info');
    if (!el) return;
    const isBlack = state.get('firstPlayer') === 'B';
    el.textContent = '';

    // 先手徽章：黑白棋子图标 + 加粗文字，最醒目
    const badge = document.createElement('span');
    badge.className = 'turn-badge ' + (isBlack ? 'black' : 'white');
    const icon = document.createElement('span');
    icon.className = 'turn-stone';
    const label = document.createElement('span');
    label.textContent = isBlack ? '黑先' : '白先';
    badge.append(icon, label);
    el.append(badge);

    // 题型 / 题号
    const parts: string[] = [];
    const tag = state.get('tag');
    if (tag) parts.push(tag);
    const title = state.get('title');
    if (title) parts.push(title);
    if (parts.length) {
      const meta = document.createElement('span');
      meta.className = 'turn-meta';
      meta.textContent = parts.join(' · ');
      el.append(meta);
    }
  }

  /** 更新按钮可用状态 */
  /**
   * 更新按钮可用状态
   * @param state - 页面状态
   * @param canStudyUndo - 研究模式下是否还有可回撤的落子
   */
  updateControls(state: PuzzlePageState, canStudyUndo = false): void {
    const hasData = !!state.get('replayData');
    const single = state.get('singlePuzzle');
    const isLib = state.get('source') === 'lib-life-death';
    const studying = state.get('mode') === 'study';
    const setDisabled = (id: string, disabled: boolean) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.disabled = disabled;
    };
    setDisabled('answer-btn', !hasData);
    // 选点开关：需有题目；研究模式已用蓝/红圈，此处禁用避免两套标记打架
    setDisabled('choices-btn', !hasData || studying);
    // 打谱页查看本题：需已归档拿到 archiveId（单题模式也可用）
    setDisabled('replay-btn', !hasData || !state.get('archiveId'));
    // 重做本题：只需有题目。单题模式（从历史打开）同样可用——
    // 重做就是重置当前题重新计时，与是否来自题库无关
    setDisabled('restart-btn', !hasData);
    // 换题：始终可用——单题模式下它是「回到题库出题」的出口，禁用会把用户锁死。
    // 空态（筛选无结果 / 加载失败）时也必须可用：此时它是「重试拉题」的唯一出口，
    // 若跟着 hasData 一起禁用，用户就卡在空态里出不来（只剩筛选按钮那条路）。
    setDisabled('next-btn', false);
    // 筛选：仅内置题库可用；单题模式禁用
    // 注意：必须与 applySourceUiState() 保持一致，否则后者设的 disabled 会被这里覆盖，
    // 出现「按钮看着能点、点了却被 click 处理里的 singlePuzzle 判断挡掉」的不一致。
    setDisabled('filter-btn', !isLib || single);
    setDisabled('solved-next-btn', !hasData);
    setDisabled('wrong-next-btn', !hasData);

    // 单题模式下换题语义变为「回到题库」，提示文案相应变化，让出口可发现
    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) nextBtn.title = single ? '换题（回到题库）' : '换题';

    // 回撤仅研究模式可用（重做入口在答错弹框内）
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement | null;
    if (undoBtn) {
      undoBtn.style.display = studying ? '' : 'none';
      undoBtn.disabled = !hasData || !studying || !canStudyUndo;
    }

    // 研究/继续答题按钮：图标切换 + 高亮态
    const answerBtn = document.getElementById('answer-btn');
    if (answerBtn) {
      answerBtn.textContent = studying ? '✋' : '👁';
      answerBtn.title = studying ? '继续答题' : '看答案（研究模式）';
      answerBtn.classList.toggle('active', studying);
    }
  }

  /** 更新模式徽章 */
  updateMode(mode: PuzzleMode): void {
    const badge = document.getElementById('mode-badge');
    if (!badge) return;
    badge.textContent = mode === 'study' ? '研究' : '答题';
    badge.className = 'mode-badge ' + (mode === 'study' ? 'explore' : 'challenge');
  }

  /** 设置加载遮罩 */
  setLoading(show: boolean, message?: string): void {
    this.state.set('loading', show);
    const overlay = document.getElementById('puzzle-loading');
    if (!overlay) return;
    overlay.style.display = show ? 'flex' : 'none';
    if (show && message) {
      const t = overlay.querySelector('.loading-title');
      if (t) t.textContent = message;
    }
  }

  /**
   * 显示空态（无题可出 / 加载失败 / 棋谱不可用）
   * @description 空态与棋盘互斥：有空态就必须把棋盘藏起来。
   *              否则「筛选无结果」时棋盘上还摆着筛选前那道题，
   *              用户看到的是旧局面 + 空态提示，误以为筛选没生效。
   */
  showEmpty(title: string, subtitle: string): void {
    const el = document.getElementById('puzzle-empty');
    if (!el) return;
    el.style.display = 'block';
    const t = el.querySelector('.empty-title');
    const s = el.querySelector('.empty-subtitle');
    if (t) t.textContent = title;
    if (s) s.textContent = subtitle;
    this.setBoardVisible(false);
  }

  /** 隐藏空态（并恢复棋盘显示） */
  hideEmpty(): void {
    const el = document.getElementById('puzzle-empty');
    if (el) el.style.display = 'none';
    this.setBoardVisible(true);
  }

  /**
   * 棋盘显示/隐藏
   * @description 隐藏棋盘容器而非 canvas 本身：WebBoard 按容器宽度算尺寸，
   *              display:none 期间 clientWidth 为 0，若此时触发 render 会把
   *              canvas 尺寸算成下限 300，恢复显示后需要一次重排修正。
   */
  private setBoardVisible(visible: boolean): void {
    const wrapper = document.querySelector<HTMLElement>('.puzzle-board-wrapper');
    if (wrapper) wrapper.style.display = visible ? '' : 'none';
    // 题目信息行（先手徽章 + 题型/题号）同属「本题」的展示，一并隐藏
    const info = document.getElementById('puzzle-info');
    if (info) info.style.display = visible ? '' : 'none';
  }

  /**
   * 设置筛选关键字显示
   * 布局：左侧筛选表达式（过长截断加 ...），右侧「已做 / 总数」（右对齐，不收缩）
   * @param keyword - 当前生效的筛选表达式，空串表示不筛选
   * @param total - 按当前条件筛出的题目数；省略则不显示数量（尚未加载完题库）
   * @param capped - 数量是否已达单次加载上限（真实总数可能更多），为 true 时加 "+" 后缀
   * @param done - 按同一条件筛出的「已做」题数；省略则只显示总数（不显示已做）
   * @description 已做数按做题历史统计（同一题多次做只算一题），口径与列表筛选一致。
   *              在线来源不传该值 —— 其题目无「类型·难度」标签，无法判定是否命中筛选。
   */
  setKeyword(keyword: string, total?: number, capped = false, done?: number): void {
    const kwEl = document.getElementById('filter-keyword');
    const countEl = document.getElementById('filter-count');
    if (kwEl) {
      const text = keyword ? `筛选：${keyword}` : '未筛选';
      kwEl.textContent = text;
      kwEl.title = keyword ? text : '';
    }
    if (countEl) {
      const suffix = capped ? '+' : '';
      if (total !== undefined && done !== undefined) {
        countEl.textContent = `已做 ${done} / 共 ${total}${suffix} 题`;
      } else if (total !== undefined) {
        countEl.textContent = `共 ${total}${suffix} 题`;
      } else {
        countEl.textContent = '';
      }
      countEl.style.display = total !== undefined ? '' : 'none';
    }
  }

  /** 显示答错弹框（按钮：重做 / 研究 / 换题） */
  showWrongModal(): void {
    const el = document.getElementById('wrong-modal');
    if (el) el.classList.add('show');
  }

  /** 显示正解弹框（按钮：研究 / 换题） */
  showSolvedModal(durationMs: number): void {
    const el = document.getElementById('solved-modal');
    if (el) el.classList.add('show');
    const d = document.getElementById('solved-duration');
    if (d) d.textContent = `用时 ${this.formatDuration(durationMs)}`;
  }

  /**
   * 格式化耗时：超过 60 秒显示为「x 分 y 秒」
   * @param ms - 耗时（毫秒）
   */
  private formatDuration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    if (total < 60) return `${total} 秒`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
  }

  /** 隐藏弹框 */
  hideModal(id: string): void {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }
}
