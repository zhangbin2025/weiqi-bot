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
    const difficultyRow = document.getElementById('difficultyRow');
    const customPanel = document.getElementById('customDifficultyPanel');
    const startGameBtn = document.getElementById('startGameBtn');

    // 难度选择
    difficultyRow?.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        difficultyRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 显示/隐藏自定义配置面板
        const value = btn.getAttribute('data-value');
        if (customPanel) {
          customPanel.style.display = value === 'custom' ? 'block' : 'none';
        }
        
        // 如果选择了预设难度，更新滑条值
        if (value && value !== 'custom') {
          this.updateSlidersFromPreset(value as 'easy' | 'medium' | 'hard');
        }
      });
    });

    // 滑条值变化监听 - visits
    const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;
    const visitsValue = document.getElementById('visitsValue');
    visitsSlider?.addEventListener('input', () => {
      if (visitsValue) visitsValue.textContent = visitsSlider.value;
    });

    // 滑条值变化监听 - noise
    const noiseSlider = document.getElementById('noiseSlider') as HTMLInputElement;
    const noiseValue = document.getElementById('noiseValue');
    noiseSlider?.addEventListener('input', () => {
      if (noiseValue) noiseValue.textContent = noiseSlider.value;
    });

    // 保存自定义难度
    const saveDifficultyBtn = document.getElementById('saveDifficultyBtn');
    saveDifficultyBtn?.addEventListener('click', () => {
      this.saveCustomDifficulty();
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

    // 加载已保存的自定义难度
    this.loadSavedDifficulties();
  }

  /**
   * 从预设难度更新滑条值
   */
  private updateSlidersFromPreset(preset: 'easy' | 'medium' | 'hard'): void {
    const presetConfig: Record<string, { visits: number; noise: number }> = {
      easy: { visits: 50, noise: 0.2 },
      medium: { visits: 100, noise: 0.1 },
      hard: { visits: 200, noise: 0 },
    };
    
    const config = presetConfig[preset];
    if (!config) return;
    
    const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;
    const visitsValue = document.getElementById('visitsValue');
    const noiseSlider = document.getElementById('noiseSlider') as HTMLInputElement;
    const noiseValue = document.getElementById('noiseValue');
    
    if (visitsSlider) {
      visitsSlider.value = String(config.visits);
      if (visitsValue) visitsValue.textContent = String(config.visits);
    }
    
    if (noiseSlider) {
      noiseSlider.value = String(config.noise);
      if (noiseValue) noiseValue.textContent = String(config.noise);
    }
  }

  /**
   * 保存自定义难度配置
   */
  private async saveCustomDifficulty(): Promise<void> {
    const labelInput = document.getElementById('difficultyLabelInput') as HTMLInputElement;
    const label = labelInput?.value?.trim();
    
    if (!label) {
      alert('请输入配置名称');
      return;
    }
    
    const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;
    const noiseSlider = document.getElementById('noiseSlider') as HTMLInputElement;
    const nnRandomize = document.getElementById('nnRandomize') as HTMLInputElement;
    
    const config: DifficultyConfig = {
      visits: parseInt(visitsSlider?.value || '100'),
      wideRootNoise: parseFloat(noiseSlider?.value || '0'),
      nnRandomize: nnRandomize?.checked || false,
      label,
    };
    
    // 保存到 localStorage
    try {
      const storageKey = 'weiqi-custom-difficulties';
      const stored = localStorage.getItem(storageKey);
      const difficulties = stored ? JSON.parse(stored) : [];
      
      difficulties.unshift({
        id: `difficulty_${Date.now()}`,
        ...config,
        createdAt: Date.now(),
      });
      
      // 最多保存 10 个配置
      if (difficulties.length > 10) {
        difficulties.pop();
      }
      
      localStorage.setItem(storageKey, JSON.stringify(difficulties));
      
      // 清空输入框
      if (labelInput) labelInput.value = '';
      
      // 刷新列表
      this.loadSavedDifficulties();
      
      alert('配置已保存');
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败');
    }
  }

  /**
   * 加载已保存的自定义难度
   */
  private loadSavedDifficulties(): void {
    const container = document.getElementById('savedDifficulties');
    if (!container) return;
    
    try {
      const storageKey = 'weiqi-custom-difficulties';
      const stored = localStorage.getItem(storageKey);
      const difficulties = stored ? JSON.parse(stored) : [];
      
      if (difficulties.length === 0) {
        container.innerHTML = '<div style="color: #999; font-size: 14px;">暂无保存的配置</div>';
        return;
      }
      
      container.innerHTML = difficulties.map((d: any) => `
        <div class="saved-difficulty-item" data-id="${d.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-top: 4px; background: rgba(255,255,255,0.8); border-radius: 4px; cursor: pointer;">
          <span>${d.label} (v:${d.visits}, n:${d.wideRootNoise})</span>
          <button class="delete-btn" data-id="${d.id}" style="background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 12px;">删除</button>
        </div>
      `).join('');
      
      // 绑定点击事件
      container.querySelectorAll('.saved-difficulty-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('delete-btn')) {
            // 删除配置
            const id = target.getAttribute('data-id');
            this.deleteCustomDifficulty(id!);
            e.stopPropagation();
          } else {
            // 加载配置
            const id = item.getAttribute('data-id');
            this.loadCustomDifficulty(id!);
          }
        });
      });
    } catch (error) {
      console.error('加载失败:', error);
    }
  }

  /**
   * 删除自定义难度
   */
  private deleteCustomDifficulty(id: string): void {
    try {
      const storageKey = 'weiqi-custom-difficulties';
      const stored = localStorage.getItem(storageKey);
      const difficulties = stored ? JSON.parse(stored) : [];
      
      const filtered = difficulties.filter((d: any) => d.id !== id);
      localStorage.setItem(storageKey, JSON.stringify(filtered));
      
      this.loadSavedDifficulties();
    } catch (error) {
      console.error('删除失败:', error);
    }
  }

  /**
   * 加载自定义难度到表单
   */
  private loadCustomDifficulty(id: string): void {
    try {
      const storageKey = 'weiqi-custom-difficulties';
      const stored = localStorage.getItem(storageKey);
      const difficulties = stored ? JSON.parse(stored) : [];
      
      const config = difficulties.find((d: any) => d.id === id);
      if (!config) return;
      
      // 更新表单值
      const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;
      const visitsValue = document.getElementById('visitsValue');
      const noiseSlider = document.getElementById('noiseSlider') as HTMLInputElement;
      const noiseValue = document.getElementById('noiseValue');
      const nnRandomize = document.getElementById('nnRandomize') as HTMLInputElement;
      
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
      
      // 切换到自定义模式
      const difficultyRow = document.getElementById('difficultyRow');
      difficultyRow?.querySelectorAll('.option-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === 'custom');
      });
    } catch (error) {
      console.error('加载失败:', error);
    }
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
    const noiseSlider = document.getElementById('noiseSlider') as HTMLInputElement;
    const nnRandomize = document.getElementById('nnRandomize') as HTMLInputElement;
    const difficultyRow = document.getElementById('difficultyRow');

    const visits = parseInt(visitsSlider?.value || '100');
    const wideRootNoise = parseFloat(noiseSlider?.value || '0');
    const nnRand = nnRandomize?.checked || false;
    const difficulty = difficultyRow?.querySelector('.option-btn.active')?.getAttribute('data-value') || 'medium';
    const playerColor = colorRow?.querySelector('.option-btn.active')?.getAttribute('data-value') as GameOptions['playerColor'] || 'black';
    const handicap = parseInt(handicapRow?.querySelector('.option-btn.active')?.getAttribute('data-value') || '0');
    const noUndo = rulesRow?.querySelector('.option-btn.active')?.getAttribute('data-value') === 'no-undo';

    // 从动态生成的模型卡片中获取选中的模型
    const selectedModelRadio = modelCardsContainer?.querySelector('input[name="aiModel"]:checked') as HTMLInputElement;
    const modelId = selectedModelRadio?.value || DefaultModelService.getDefaultModelId();

    const options: GameOptions = { visits, playerColor, handicap, modelId, noUndo };
    
    // 如果是自定义难度，保存配置
    if (difficulty === 'custom') {
      (options as any).difficultyConfig = {
        visits,
        wideRootNoise,
        nnRandomize: nnRand,
        label: '自定义',
      };
    }
    
    return options;
  }
}
