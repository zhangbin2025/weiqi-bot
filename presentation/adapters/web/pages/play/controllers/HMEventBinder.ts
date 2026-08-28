/**
 * 人机对弈事件绑定器
 * @module presentation/pages/play/controllers/HMEventBinder
 */

import type { HMPlayPage } from '../HMPlayPage';
import type { GameOptions } from '../HMPlayPage';
import type { DifficultyConfig } from '@services/ai/types';
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
    const difficultySelect = document.getElementById('difficultySelect') as HTMLSelectElement;
    const configDifficultyBtn = document.getElementById('configDifficultyBtn');

    // 加载已保存的难度配置
    this.loadDifficultyOptions();

    // 难度选择变化
    difficultySelect?.addEventListener('change', () => {
      // 保存选择的难度
      const selectedValue = difficultySelect.value;
      localStorage.setItem('weiqi-selected-difficulty', selectedValue);
    });

    // 打开配置弹框
    configDifficultyBtn?.addEventListener('click', () => {
      this.showDifficultyConfigDialog();
    });
    
    // 绑定配置弹框的事件（只绑定一次）
    this.bindDifficultyConfigEvents();

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

    // 加载已保存的自定义难度
    this.loadDifficultyOptions();
  }

  /**
   * 从对话框获取选项
   */
  private getOptionsFromDialog(): GameOptions {
    const colorRow = document.getElementById('colorRow');
    const handicapRow = document.getElementById('handicapRow');
    const rulesRow = document.getElementById('rulesRow');
    const modelCardsContainer = document.getElementById('modelCards');
    const difficultySelect = document.getElementById('difficultySelect') as HTMLSelectElement;

    const difficultyValue = difficultySelect?.value || 'default';
    const playerColor = colorRow?.querySelector('.option-btn.active')?.getAttribute('data-value') as GameOptions['playerColor'] || 'black';
    const handicap = parseInt(handicapRow?.querySelector('.option-btn.active')?.getAttribute('data-value') || '0');
    const noUndo = rulesRow?.querySelector('.option-btn.active')?.getAttribute('data-value') === 'no-undo';

    // 从动态生成的模型卡片中获取选中的模型
    const selectedModelRadio = modelCardsContainer?.querySelector('input[name="aiModel"]:checked') as HTMLInputElement;
    const modelId = selectedModelRadio?.value || DefaultModelService.getDefaultModelId();

    // 获取难度配置
    let difficultyConfig: DifficultyConfig;
    if (difficultyValue === 'default') {
      difficultyConfig = {
        visits: 20,
        wideRootNoise: 0,
        nnRandomize: false,
        label: '默认',
      };
    } else {
      // 从本地存储加载配置
      const stored = localStorage.getItem('weiqi-custom-difficulties');
      const difficulties = stored ? JSON.parse(stored) : [];
      const found = difficulties.find((d: any) => d.id === difficultyValue);
      if (found) {
        difficultyConfig = {
          visits: found.visits,
          wideRootNoise: found.wideRootNoise,
          nnRandomize: found.nnRandomize,
          label: found.label,
        };
      } else {
        // fallback to default
        difficultyConfig = {
          visits: 20,
          wideRootNoise: 0,
          nnRandomize: false,
          label: '默认',
        };
      }
    }

    const options: GameOptions = {
      visits: difficultyConfig.visits,
      playerColor,
      handicap,
      modelId,
      noUndo
    };
    
    (options as any).difficultyConfig = difficultyConfig;
    
    return options;
  }

  /**
   * 加载难度选项到下拉框
   */
  private loadDifficultyOptions(): void {
    const select = document.getElementById('difficultySelect') as HTMLSelectElement;
    if (!select) return;
    
    // 清空现有选项
    select.innerHTML = '<option value="default">默认</option>';
    
    // 加载已保存的配置
    const stored = localStorage.getItem('weiqi-custom-difficulties');
    const difficulties = stored ? JSON.parse(stored) : [];
    
    difficulties.forEach((d: any) => {
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = d.label;
      select.appendChild(option);
    });
    
    // 恢复上次选择的难度
    const lastSelected = localStorage.getItem('weiqi-selected-difficulty');
    if (lastSelected) {
      select.value = lastSelected;
    }
  }

  /**
   * 绑定配置弹框事件（只执行一次）
   */
  private difficultyConfigEventsBound = false;
  
  private bindDifficultyConfigEvents(): void {
    if (this.difficultyConfigEventsBound) return;
    
    const saveBtn = document.getElementById('saveDifficultyConfigBtn');
    const cancelBtn = document.getElementById('cancelDifficultyConfigBtn');
    const visitsSlider = document.getElementById('configVisitsSlider') as HTMLInputElement;
    const visitsValue = document.getElementById('configVisitsValue');
    const noiseSlider = document.getElementById('configNoiseSlider') as HTMLInputElement;
    const noiseValue = document.getElementById('configNoiseValue');
    
    // 滑条事件
    visitsSlider?.addEventListener('input', () => {
      if (visitsValue) visitsValue.textContent = visitsSlider.value;
    });
    
    noiseSlider?.addEventListener('input', () => {
      if (noiseValue) noiseValue.textContent = noiseSlider.value;
    });
    
    // 保存按钮
    saveBtn?.addEventListener('click', () => {
      this.saveNewDifficulty();
      const dialog = document.getElementById('difficultyConfigDialog');
      if (dialog) dialog.style.display = 'none';
    });
    
    // 取消按钮
    cancelBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('difficultyConfigDialog');
      if (dialog) dialog.style.display = 'none';
    });
    
    this.difficultyConfigEventsBound = true;
  }

  /**
   * 显示难度配置弹框
   */
  private showDifficultyConfigDialog(): void {
    const dialog = document.getElementById('difficultyConfigDialog');
    if (!dialog) return;
    
    // 设置默认值
    const visitsSlider = document.getElementById('configVisitsSlider') as HTMLInputElement;
    const visitsValue = document.getElementById('configVisitsValue');
    const noiseSlider = document.getElementById('configNoiseSlider') as HTMLInputElement;
    const noiseValue = document.getElementById('configNoiseValue');
    const nnRandomize = document.getElementById('configNnRandomize') as HTMLInputElement;
    const labelInput = document.getElementById('configDifficultyLabel') as HTMLInputElement;
    
    if (visitsSlider) {
      visitsSlider.value = '20';
      if (visitsValue) visitsValue.textContent = '20';
    }
    if (noiseSlider) {
      noiseSlider.value = '0';
      if (noiseValue) noiseValue.textContent = '0';
    }
    if (nnRandomize) {
      nnRandomize.checked = false;
    }
    if (labelInput) {
      labelInput.value = '';
    }
    
    // 加载已保存的配置列表
    this.loadSavedDifficultyList();
    
    dialog.style.display = 'flex';
  }

  /**
   * 保存新难度配置
   */
  private saveNewDifficulty(): void {
    const visitsSlider = document.getElementById('configVisitsSlider') as HTMLInputElement;
    const noiseSlider = document.getElementById('configNoiseSlider') as HTMLInputElement;
    const nnRandomize = document.getElementById('configNnRandomize') as HTMLInputElement;
    const labelInput = document.getElementById('configDifficultyLabel') as HTMLInputElement;
    
    const visits = parseInt(visitsSlider?.value || '20');
    const wideRootNoise = parseFloat(noiseSlider?.value || '0');
    const nnRand = nnRandomize?.checked || false;
    const customLabel = labelInput?.value?.trim();
    
    // 加载已保存的配置
    const stored = localStorage.getItem('weiqi-custom-difficulties');
    let difficulties = stored ? JSON.parse(stored) : [];
    
    let label: string;
    let existingIndex = -1;
    
    if (customLabel) {
      // 用户输入了自定义名称，检查是否已存在
      existingIndex = difficulties.findIndex((d: any) => d.label === customLabel);
      label = customLabel;
    } else {
      // 自动命名：难度1、难度2...
      label = `难度${difficulties.length + 1}`;
    }
    
    const newConfig = {
      id: existingIndex >= 0 ? difficulties[existingIndex].id : `difficulty_${Date.now()}`,
      visits,
      wideRootNoise,
      nnRandomize: nnRand,
      label,
      createdAt: existingIndex >= 0 ? difficulties[existingIndex].createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    
    if (existingIndex >= 0) {
      // 更新已存在的配置
      difficulties[existingIndex] = newConfig;
    } else {
      // 添加新配置
      difficulties.push(newConfig);
      
      // 最多保存 10 个
      if (difficulties.length > 10) {
        difficulties.shift();
      }
    }
    
    localStorage.setItem('weiqi-custom-difficulties', JSON.stringify(difficulties));
    
    // 刷新下拉框和列表
    this.loadDifficultyOptions();
    this.loadSavedDifficultyList();
    
    // 选中新保存的配置
    const select = document.getElementById('difficultySelect') as HTMLSelectElement;
    if (select) {
      select.value = newConfig.id;
      localStorage.setItem('weiqi-selected-difficulty', newConfig.id);
    }
  }

  /**
   * 加载已保存的配置列表
   */
  private loadSavedDifficultyList(): void {
    const container = document.getElementById('savedDifficultyList');
    if (!container) return;
    
    const stored = localStorage.getItem('weiqi-custom-difficulties');
    const difficulties = stored ? JSON.parse(stored) : [];
    
    if (difficulties.length === 0) {
      container.innerHTML = '<div style="color: #999; font-size: 14px; text-align: center; padding: 20px;">暂无保存的配置</div>';
      return;
    }
    
    container.innerHTML = difficulties.map((d: any) => `
      <div class="saved-difficulty-item">
        <div>
          <div class="item-label">${d.label}</div>
          <div class="item-info">v:${d.visits}, n:${d.wideRootNoise}, nn:${d.nnRandomize ? '是' : '否'}</div>
        </div>
        <div class="item-actions">
          <button class="item-btn load" data-id="${d.id}">加载</button>
          <button class="item-btn delete" data-id="${d.id}">删除</button>
        </div>
      </div>
    `).join('');
    
    // 绑定按钮事件
    container.querySelectorAll('.item-btn.load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        this.loadDifficultyToForm(id!);
      });
    });
    
    container.querySelectorAll('.item-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        this.deleteDifficulty(id!);
      });
    });
  }

  /**
   * 加载配置到表单
   */
  private loadDifficultyToForm(id: string): void {
    const stored = localStorage.getItem('weiqi-custom-difficulties');
    const difficulties = stored ? JSON.parse(stored) : [];
    const config = difficulties.find((d: any) => d.id === id);
    
    if (!config) return;
    
    const visitsSlider = document.getElementById('configVisitsSlider') as HTMLInputElement;
    const visitsValue = document.getElementById('configVisitsValue');
    const noiseSlider = document.getElementById('configNoiseSlider') as HTMLInputElement;
    const noiseValue = document.getElementById('configNoiseValue');
    const nnRandomize = document.getElementById('configNnRandomize') as HTMLInputElement;
    const labelInput = document.getElementById('configDifficultyLabel') as HTMLInputElement;
    
    if (visitsSlider) {
      visitsSlider.value = String(config.visits);
      if (visitsValue) visitsValue.textContent = String(config.visits);
    }
    if (noiseSlider) {
      noiseSlider.value = String(config.wideRootNoise);
      if (noiseValue) noiseValue.textContent = String(config.wideRootNoise);
    }
    if (nnRandomize) {
      nnRandomize.checked = config.nnRandomize;
    }
    if (labelInput) {
      labelInput.value = config.label;
    }
  }

  /**
   * 删除配置
   */
  private deleteDifficulty(id: string): void {
    const stored = localStorage.getItem('weiqi-custom-difficulties');
    let difficulties = stored ? JSON.parse(stored) : [];
    
    difficulties = difficulties.filter((d: any) => d.id !== id);
    localStorage.setItem('weiqi-custom-difficulties', JSON.stringify(difficulties));
    
    // 刷新列表和下拉框
    this.loadSavedDifficultyList();
    this.loadDifficultyOptions();
  }
}
