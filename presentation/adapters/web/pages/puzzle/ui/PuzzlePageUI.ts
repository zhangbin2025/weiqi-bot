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
   * 规则：先手必显示；有题型显示题型；有题号显示题号；来源不显示（上方下拉框已表明）
   */
  updatePuzzleInfo(state: PuzzlePageState): void {
    const el = document.getElementById('puzzle-info');
    if (!el) return;
    const parts: string[] = [
      state.get('firstPlayer') === 'B' ? '黑先' : '白先',
    ];
    const tag = state.get('tag');
    if (tag) parts.push(tag);
    const title = state.get('title');
    if (title) parts.push(title);
    el.textContent = parts.join(' · ');
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
    // 打谱页查看本题：有题目即可用（单题模式也可用）
    setDisabled('replay-btn', !hasData);
    // 换题：单题模式禁用
    setDisabled('next-btn', !hasData || single);
    // 筛选：仅内置题库可用；单题模式禁用
    setDisabled('filter-btn', !isLib || single);
    // 弹框内的换题同样受单题模式约束
    setDisabled('solved-next-btn', !hasData || single);
    setDisabled('wrong-next-btn', !hasData || single);

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

  /** 显示空态 */
  showEmpty(title: string, subtitle: string): void {
    const el = document.getElementById('puzzle-empty');
    if (!el) return;
    el.style.display = 'block';
    const t = el.querySelector('.empty-title');
    const s = el.querySelector('.empty-subtitle');
    if (t) t.textContent = title;
    if (s) s.textContent = subtitle;
  }

  /** 隐藏空态 */
  hideEmpty(): void {
    const el = document.getElementById('puzzle-empty');
    if (el) el.style.display = 'none';
  }

  /** 设置筛选关键字显示 */
  setKeyword(keyword: string): void {
    const el = document.getElementById('filter-keyword');
    if (el) el.textContent = keyword ? `筛选：${keyword}` : '';
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
