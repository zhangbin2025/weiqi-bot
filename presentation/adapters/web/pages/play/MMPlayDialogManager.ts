/**
 * AI自对弈对话框管理器
 * @module presentation/pages/play/MMPlayDialogManager
 */
import type { MMPlayApp } from '../../../../../application/play';
import type { IModelManagementService } from '../../../../../services/model';
import type { ModelConfig } from '../../../../../services/model';
import { DefaultModelService } from '../../../../../services/model';
import type { PlaySpeed } from '../../../../../services/play/mm/types';
import { getWebRoot } from '../../../../../infrastructure/utils/web/pathUtils';
import { Select } from '@ui';
import { ModelSelector } from '../../components/ModelSelector';
import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

export interface MMDialogOptions {
  modelId: string;
  visits: number;
  speed: PlaySpeed;
  modelUrl?: string;  // 自定义模型的 URL
}

export interface MMDialogCallbacks {
  onStart: (options: MMDialogOptions) => Promise<void>;
}

/**
 * 显示AI自对弈设置对话框
 */
export async function showSettingsDialog(
  mmPlayApp: MMPlayApp,
  callbacks: MMDialogCallbacks,
  modelManager?: IModelManagementService
): Promise<void> {
  const container = document.getElementById('dialogContainer');
  if (!container) return;
  
  // 读取保存的选项
  const optionsStorage = new LocalStorageAdapter('weiqi-mm-options');
  await optionsStorage.initialize();
  const savedOptions = await optionsStorage.read<{ visits?: number; speed?: PlaySpeed }>('options');
  const visits = savedOptions?.visits ?? 50;
  const speed = savedOptions?.speed ?? 'normal';
  
  // 创建 ModelSelector 实例
  const currentModelId = modelManager?.getCurrentModel() || DefaultModelService.getDefaultModelId();
  const modelSelector = new ModelSelector({
    currentModelId,
    modelManager,
  });
  
  // 加载模型列表
  await modelSelector.loadModels();
  
  container.innerHTML = `
    <div class="dialog-overlay" style="display: flex;">
      <div class="dialog">
        <div class="dialog-title">AI自对弈设置</div>
        <div class="form-group">
          <label>AI 模型</label>
          ${modelSelector.render()}
        </div>
        <div class="options-section">
          <label>计算量（visits）</label>
          <div class="slider-row" style="display: flex; align-items: center;">
            <input type="range" id="visitsSlider" min="10" max="500" value="${visits}" step="1" style="flex: 1;">
            <span id="visitsValue" class="slider-num" style="text-align: right; min-width: 32px; margin-left: 4px;">${visits}</span>
          </div>
        </div>
        <div class="form-group">
          <label>对弈速度</label>
          <div data-ui="select" id="speed"
               data-value="${speed}"
               data-options='[{"value":"instant","label":"极速"},{"value":"fast","label":"快速"},{"value":"normal","label":"正常"},{"value":"slow","label":"慢速"}]'></div>
        </div>
        <div class="dialog-btn-group">
          <button class="dialog-btn primary" id="startBtn">开始对局</button>
          <button class="dialog-btn secondary" id="cancelBtn">取消</button>
        </div>
      </div>
    </div>
  `;
  
  // 挂载自定义下拉框
  Select.mountAll(container);
  
  // 绑定 ModelSelector 事件
  modelSelector.bindEvents(container);
  
  // 绑定滑条值变化事件
  const slider = document.getElementById('visitsSlider') as HTMLInputElement;
  const valueEl = document.getElementById('visitsValue');
  slider?.addEventListener('input', () => {
    if (valueEl) valueEl.textContent = slider.value;
  });
  
    // 绑定按钮事件
  document.getElementById('startBtn')?.addEventListener('click', async () => {
    const modelId = modelSelector.getSelectedModelId() || DefaultModelService.getDefaultModelId();
    let customModelUrl = modelSelector.getCustomModelUrl();
    const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;
    const speedSelect = Select.get('#speed');
    
    const options: MMDialogOptions = {
      modelId,
      visits: parseInt(visitsSlider?.value || '50'),
      speed: (speedSelect?.getValue() || 'normal') as PlaySpeed,
    };
    
    // 保存选项
    await optionsStorage.write('options', { visits: options.visits, speed: options.speed });
    
    // 切换模型（如果有 ModelManagementService）
    if (modelManager) {
      try {
        // 如果选择了自定义模型，传递自定义模型的 URL
        let modelUrl: string | undefined;
        if (modelId === 'custom') {
          // 从 modelSelector 获取 URL，如果没有则从存储加载
          modelUrl = customModelUrl || undefined;
          
          if (!modelUrl && typeof modelManager.loadCustomModelUrl === 'function') {
            modelUrl = (await modelManager.loadCustomModelUrl()) || undefined;
          }
        }
        
        // 注意：不在这里调用 modelManager.switchModel()
        // 让 MMPlayPage.startAutoPlay() 负责切换模型和显示进度
        // 保存模型 URL 到 options，让后续流程使用
        if (modelUrl) {
          options.modelUrl = modelUrl;
        }
      } catch (error) {
        console.error('Failed to prepare model URL:', error);
        // 继续执行，即使准备失败
      }
    }
    
    container.innerHTML = '';
    await callbacks.onStart(options);
  });
  
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    window.location.href = getWebRoot() + 'index.html';
  });
}
