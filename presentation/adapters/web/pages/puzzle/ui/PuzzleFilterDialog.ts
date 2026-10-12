/**
 * 做题筛选题型/难度弹框
 * @description 题型与难度均支持复选，生成 and/or 关键字。与 fetcher 共用 puzzleFilter 常量。
 */
import {
  PUZZLE_FILTER_TYPES,
  PUZZLE_FILTER_DIFFICULTIES,
  normalizeDifficulties,
  type PuzzleFilterState,
} from '../../../../../../services/game/providers/library/puzzleFilter';

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
    // 兼容旧版单值难度偏好
    const difficulties = saved
      ? normalizeDifficulties(saved.difficulties ?? saved.difficulty)
      : [];
    const diffSet = new Set(difficulties);

    const dialog = document.createElement('div');
    dialog.className = 'puzzle-filter-dialog';

    const typeCheckboxes = PUZZLE_FILTER_TYPES.map((t) => (
      '<label class="puzzle-filter-type">' +
        '<input type="checkbox" data-type="' + t.value + '"' +
          (types.includes(t.value) ? ' checked' : '') + ' />' +
        '<span>' + t.label + '</span>' +
      '</label>'
    )).join('');

    // 难度与题型一致改用复选胶囊：多选后按 or 组合，
    // 「全部难度」由「清空」按钮表达（一个都不选 = 不按难度筛选）
    const difficultyChips = PUZZLE_FILTER_DIFFICULTIES.map((d) => (
      '<label class="puzzle-filter-diff' + (diffSet.has(d) ? ' active' : '') + '">' +
        '<input type="checkbox" data-difficulty="' + d + '"' +
          (diffSet.has(d) ? ' checked' : '') + ' />' +
        '<span>' + d + '</span>' +
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
            '<div class="puzzle-filter-label puzzle-filter-label-row">' +
              '<span>难度（可多选，不选=全部）</span>' +
              '<button type="button" class="puzzle-filter-clear" data-act="clear-diff">清空</button>' +
            '</div>' +
            '<div class="puzzle-filter-difficulties">' + difficultyChips + '</div>' +
          '</div>' +
          '<div class="dialog-btn-group">' +
            '<button class="dialog-btn secondary" data-act="cancel">取消</button>' +
            '<button class="dialog-btn primary" data-act="ok">开始做题</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(dialog);

    /** 选中态同步到胶囊样式（active 高亮） */
    const syncChip = (input: HTMLInputElement) => {
      const label = input.closest('.puzzle-filter-diff');
      if (label) label.classList.toggle('active', input.checked);
    };
    dialog.querySelectorAll<HTMLInputElement>('input[data-difficulty]').forEach((input) => {
      input.addEventListener('change', () => syncChip(input));
    });

    /** 读取当前勾选的难度（保持选项表顺序，保证关键字稳定） */
    const readDifficulties = (): string[] => {
      const picked: string[] = [];
      dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-difficulty]')
        .forEach((cb) => { if (cb.checked && cb.dataset['difficulty']) picked.push(cb.dataset['difficulty']!); });
      return PUZZLE_FILTER_DIFFICULTIES.filter((d) => picked.includes(d));
    };

    const clearBtn = dialog.querySelector('[data-act="clear-diff"]');
    clearBtn?.addEventListener('click', () => {
      dialog.querySelectorAll<HTMLInputElement>('input[data-difficulty]').forEach((input) => {
        input.checked = false;
        syncChip(input);
      });
    });

    const close = () => dialog.remove();
    dialog.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
    dialog.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const picked: string[] = [];
      dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-type]:checked')
        .forEach((cb) => { const v = cb.dataset['type']; if (v) picked.push(v); });
      onSubmit({ types: picked, difficulties: readDifficulties() });
      close();
    });
    const overlayEl = dialog.querySelector('.dialog-overlay');
    overlayEl?.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  }
}
