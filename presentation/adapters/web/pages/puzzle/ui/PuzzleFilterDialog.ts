/**
 * 做题筛选题型/难度弹框
 * @description 复选题型 + 单选难度，生成 and/or 关键字。与 fetcher 共用 puzzleFilter 常量。
 */
import {
  PUZZLE_FILTER_TYPES,
  PUZZLE_FILTER_DIFFICULTIES,
  PUZZLE_FILTER_ALL_DIFFICULTY_OPTION,
  type PuzzleFilterState,
} from '../../../../../../services/game/providers/library/puzzleFilter';
import { Select } from '@ui';

/** 做题筛选弹框 */
export class PuzzleFilterDialog {
  /**
   * 打开筛选弹框
   * @param loadState - 读取上次保存的筛选状态
   * @param onSubmit - 提交回调（传入题型/难度选择）
   */
  static open(
    loadState: () => PuzzleFilterState | null,
    onSubmit: (state: PuzzleFilterState) => void,
  ): void {
    const saved = loadState();
    const types = saved && saved.types.length > 0
      ? saved.types
      : [PUZZLE_FILTER_TYPES[0]!.value];
    const difficulty = saved ? saved.difficulty : '';

    const dialog = document.createElement('div');
    dialog.className = 'puzzle-filter-dialog';

    const typeCheckboxes = PUZZLE_FILTER_TYPES.map((t) => (
      '<label class="puzzle-filter-type">' +
        '<input type="checkbox" data-type="' + t.value + '"' +
          (types.includes(t.value) ? ' checked' : '') + ' />' +
        '<span>' + t.label + '</span>' +
      '</label>'
    )).join('');

    dialog.innerHTML = (
      '<div class="dialog-overlay show">' +
        '<div class="dialog">' +
          '<div class="dialog-title">筛选题目</div>' +
          '<div class="puzzle-filter-section">' +
            '<div class="puzzle-filter-label">题型（可多选，不选=全部）</div>' +
            '<div class="puzzle-filter-types">' + typeCheckboxes + '</div>' +
          '</div>' +
          '<div class="puzzle-filter-section">' +
            '<div class="puzzle-filter-label">难度（单选，默认全部）</div>' +
            '<div class="puzzle-filter-difficulty" id="puzzleFilterDifficulty"></div>' +
          '</div>' +
          '<div class="dialog-btn-group">' +
            '<button class="dialog-btn secondary" data-act="cancel">取消</button>' +
            '<button class="dialog-btn primary" data-act="ok">开始做题</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(dialog);

    const host = dialog.querySelector('#puzzleFilterDifficulty') as HTMLElement;
    // 首位显式放置「全部难度」：自绘 Select 再次点击已选项不会取消，
    // 只有它是回到「不按难度筛选」的唯一入口
    const diffSelect = Select.mount(host, {
      options: [
        PUZZLE_FILTER_ALL_DIFFICULTY_OPTION,
        ...PUZZLE_FILTER_DIFFICULTIES.map((d) => ({ value: d, label: d })),
      ],
      value: difficulty,
      placeholder: '全部难度',
    });

    const close = () => dialog.remove();
    dialog.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
    dialog.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const picked: string[] = [];
      dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-type]:checked')
        .forEach((cb) => { const v = cb.dataset['type']; if (v) picked.push(v); });
      onSubmit({ types: picked, difficulty: diffSelect ? diffSelect.getValue() : '' });
      close();
    });
    const overlayEl = dialog.querySelector('.dialog-overlay');
    overlayEl?.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  }
}
