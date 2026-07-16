/**
 * 人机对弈事件绑定器
 * @module presentation/pages/play/controllers/HMEventBinder
 */

import type { HMPlayPage } from '../HMPlayPage';
import type { GameOptions } from '../HMPlayPage';
import { DefaultModelService } from '@services/model';

/**
 * 事件绑定配置
 */
export interface HMEventBinderConfig {
  page: HMPlayPage;
  onStartGame: (options: GameOptions) => Promise<void>;
}

/**
 * 人机对弈事件绑定器
 * 负责绑定所有 UI 事件（菜单、工具栏、对话框、选项）
 */
export class HMEventBinder {
  private config: HMEventBinderConfig;

  constructor(config: HMEventBinderConfig) {
    this.config = config;
  }

  /**
   * 绑定所有 UI 事件
   */
  bindAll(): void {
    this.bindMenuEvents();
    this.bindToolbarEvents();
    this.bindDialogEvents();
    this.bindOptionsEvents();
  }

  /**
   * 绑定菜单事件
   */
  private bindMenuEvents(): void {
    const menuBtn = document.getElementById('menuBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');

    if (!menuBtn || !dropdownMenu) return;

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('visible');
    });

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown')) {
        dropdownMenu.classList.remove('visible');
      }
    });
  }

  /**
   * 绑定工具栏按钮事件
   */
  private bindToolbarEvents(): void {
    const confirmBtn = document.getElementById('confirmBtn');
    const situationBtn = document.getElementById('situationBtn');

    // 菜单中的按钮
    const menuUndoBtn = document.getElementById('menuUndoBtn');
    const menuPassBtn = document.getElementById('menuPassBtn');
    const menuResignBtn = document.getElementById('menuResignBtn');

    // 工具栏按钮
    confirmBtn?.addEventListener('click', () => {
      this.config.page.confirmMove();
    });

    situationBtn?.addEventListener('click', () => {
      this.config.page.showSituation();
    });

    // 菜单按钮事件
    menuUndoBtn?.addEventListener('click', () => {
      this.config.page.undo();
      this.closeMenu();
    });

    menuPassBtn?.addEventListener('click', () => {
      this.config.page.pass();
      this.closeMenu();
    });

    menuResignBtn?.addEventListener('click', () => {
      this.config.page.resign();
      this.closeMenu();
    });
  }

  /**
   * 关闭菜单
   */
  private closeMenu(): void {
    const dropdownMenu = document.getElementById('dropdownMenu');
    if (dropdownMenu) {
      dropdownMenu.classList.remove('visible');
    }
  }

  /**
   * 绑定弹框按钮事件
   */
  private bindDialogEvents(): void {
    // 关闭形势判断弹框
    const closeSituationBtn = document.getElementById('closeSituationBtn');
    closeSituationBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('situationDialog');
      if (dialog) dialog.style.display = 'none';
    });

    // 确认对话框按钮
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const confirmOkBtn = document.getElementById('confirmOkBtn');

    confirmCancelBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('confirmDialog');
      if (dialog) dialog.style.display = 'none';
      window.dispatchEvent(new CustomEvent('confirmCancel'));
    });

    confirmOkBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('confirmDialog');
      if (dialog) dialog.style.display = 'none';
      window.dispatchEvent(new CustomEvent('confirmOk'));
    });
  }

  /**
   * 绑定选项对话框事件
   */
  private bindOptionsEvents(): void {
    const colorRow = document.getElementById('colorRow');
    const handicapRow = document.getElementById('handicapRow');
    const rulesRow = document.getElementById('rulesRow');
    const startGameBtn = document.getElementById('startGameBtn');

    // 滑条值变化监听
    const slider = document.getElementById('visitsSlider') as HTMLInputElement;
    const valueEl = document.getElementById('visitsValue');
    slider?.addEventListener('input', () => {
      if (valueEl) valueEl.textContent = slider.value;
    });

    // 执色选择
    colorRow?.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        colorRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 让子选择
    handicapRow?.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handicapRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 规则选择
    rulesRow?.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        rulesRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 开始对局
    startGameBtn?.addEventListener('click', () => {
      const options = this.getOptionsFromDialog();
      this.config.onStartGame(options);
    });
  }

  /**
   * 从对话框获取选项
   */
  private getOptionsFromDialog(): GameOptions {
    const colorRow = document.getElementById('colorRow');
    const handicapRow = document.getElementById('handicapRow');
    const rulesRow = document.getElementById('rulesRow');
    const modelCardsContainer = document.getElementById('modelCards');
    const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;

    const visits = parseInt(visitsSlider?.value || '100');
    const playerColor = colorRow?.querySelector('.option-btn.active')?.getAttribute('data-value') as GameOptions['playerColor'] || 'black';
    const handicap = parseInt(handicapRow?.querySelector('.option-btn.active')?.getAttribute('data-value') || '0');
    const noUndo = rulesRow?.querySelector('.option-btn.active')?.getAttribute('data-value') === 'no-undo';

    // 从动态生成的模型卡片中获取选中的模型
    const selectedModelRadio = modelCardsContainer?.querySelector('input[name="aiModel"]:checked') as HTMLInputElement;
    const modelId = selectedModelRadio?.value || DefaultModelService.getDefaultModelId();

    return { visits, playerColor, handicap, modelId, noUndo };
  }
}
