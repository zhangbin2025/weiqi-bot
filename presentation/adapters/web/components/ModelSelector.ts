/**
 * @fileoverview 模型选择器 UI 组件
 * @description 统一的模型选择 UI 组件，可以嵌入到任何对话框中
 */

import type { IModelManagementService } from '../../../../services/model';
import type { ModelConfig } from '../../../../services/model';
import { TunnelManager } from '../../../../infrastructure/tunnel/TunnelManager';

/**
 * 模型选择器选项
 */
export interface ModelSelectorOptions {
  /** 模型管理服务 */
  modelManager?: IModelManagementService | undefined;
  
  /** 当前选中的模型 ID */
  currentModelId?: string | null;
  
  /** 模型选择变化回调 */
  onModelChange?: (modelId: string) => void;
}

/**
 * 模型选择器 UI 组件
 * 
 * 使用方式：
 * ```typescript
 * const selector = new ModelSelector({ modelManager });
 * container.innerHTML = selector.render();
 * selector.bindEvents(container);
 * ```
 */
export class ModelSelector {
  private models: ModelConfig[] = [];
  private selectedModelId: string | null = null;
  private customModelUrl: string = '';
  private onModelChange?: ((modelId: string) => void) | undefined;
  private isAppEnvironment: boolean;
  private isRemoteMode: boolean;

  constructor(private options: ModelSelectorOptions) {
    this.selectedModelId = options.currentModelId ?? null;
    if (options.onModelChange) {
      this.onModelChange = options.onModelChange;
    }
    // 检测是否在 App 环境
    this.isAppEnvironment = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
    // 检测是否在远程隧道客户端模式（模型由服务端决定，只读显示）
    this.isRemoteMode = TunnelManager.getInstance().isClientMode();
  }

  /**
   * 加载模型列表
   */
  async loadModels(): Promise<void> {
    if (this.options.modelManager) {
      try {
        this.models = await this.options.modelManager.getModels();
      } catch (error) {
        // 远程模式下服务端不在线，使用空列表让 UI 正常渲染
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('远程服务端不在线')) {
          console.warn('[ModelSelector] 远程服务端不在线，模型列表为空');
          this.models = [];
          return;
        }
        throw error;
      }
    }
    // 远程模式：从模型列表中提取 custom URL，选中服务端当前模型
    if (this.isRemoteMode) {
      const customModel = this.models.find(m => m.id === 'custom');
      if (customModel?.url) {
        this.customModelUrl = customModel.url;
      }
      // 优先选中服务端当前加载的模型，fallback 到默认模型
      const currentModel = this.models.find(m => m.isCurrent);
      const defaultModel = currentModel || this.models.find(m => m.isDefault) || this.models[0];
      if (defaultModel) {
        this.selectedModelId = defaultModel.id;
      }
      return;
    }
    
    // 本地模式：从存储加载保存的模型 ID 和自定义模型的 URL
    if (this.options.modelManager && typeof this.options.modelManager.loadPreference === 'function') {
      const savedModelId = await this.options.modelManager.loadPreference();
      if (savedModelId) {
        this.selectedModelId = savedModelId;
        console.info('[ModelSelector] Loaded saved model:', savedModelId);
        
        // 如果是自定义模型，加载 URL
        if (savedModelId === 'custom' && typeof this.options.modelManager.loadCustomModelUrl === 'function') {
          const savedUrl = await this.options.modelManager.loadCustomModelUrl();
          if (savedUrl) {
            this.customModelUrl = savedUrl;
            console.info('[ModelSelector] Loaded custom model URL:', savedUrl);
          }
        }
      }
    }
    
    // 如果没有选中模型，默认选中第一个
    if (!this.selectedModelId && this.models.length > 0) {
      const defaultModel = this.models.find(m => m.isDefault) || this.models[0];
      if (defaultModel) {
        this.selectedModelId = defaultModel.id;
      }
    }
  }

  /**
   * 渲染模型选择器 UI
   */
  render(): string {
    // 远程模式：所有控件只读，布局和本地完全一致
    const ro = this.isRemoteMode; // readonly flag

    const modelOptionsHtml = this.models.filter(m => !(ro && m.id === 'custom')).map(model => {
      const isSelected = model.id === this.selectedModelId;
      return `
        <label style="display: flex; align-items: center; gap: 8px; padding: 8px 0; ${ro ? '' : 'cursor: pointer;'}">
          <input type="radio" name="aiModel" value="${model.id}" ${isSelected ? 'checked' : ''} ${ro ? 'disabled' : ''} style="width: auto; ${ro ? 'opacity: 0.6;' : ''}">
          <span style="flex: 1; font-size: 13px;">${model.name}</span>
          <span style="font-size: 12px; color: #999; text-align: right; min-width: 50px;">${model.size}</span>
        </label>
      `;
    }).join('');

    // 自定义模型选项（App 环境显示，远程模式下也显示但只读）
    const showCustom = this.isAppEnvironment || (ro && this.selectedModelId === 'custom');
    const customOptionHtml = showCustom ? `
      <label id="customModelLabel" style="display: flex; align-items: center; gap: 8px; padding: 8px 0; ${ro ? '' : 'cursor: pointer;'}">
        <input type="radio" name="aiModel" value="custom" ${this.selectedModelId === 'custom' ? 'checked' : ''} ${ro ? 'disabled' : ''} style="width: auto; ${ro ? 'opacity: 0.6;' : ''}">
        <div style="flex: 1;">
          <span style="font-size: 13px;">自定义模型</span> <a href="https://katagotraining.org/networks/" target="_blank" style="font-size: 11px; color: #4a90e2; margin-left: 8px;">模型列表 ↗</a>
        </div>
      </label>
      <div id="customModelUrlContainer" style="display: ${this.selectedModelId === 'custom' ? 'block' : 'none'}; padding: 8px 0;">
        <input type="url" id="customModelUrl" placeholder="https://example.com/model.bin.gz" 
               value="${this.customModelUrl}"
               inputmode="none"
               ${ro ? 'readonly' : ''}
               style="width: 100%; padding: 8px; border: 1px solid ${ro ? '#e8e8e8' : '#ddd'}; border-radius: 4px; font-size: 12px; box-sizing: border-box; ${ro ? 'color: #666; background: #f9f9f9;' : ''}">
        <div style="font-size: 11px; color: #999; margin-top: 4px;">${ro ? '' : '长按输入框可粘贴URL'}</div>
      </div>
    ` : '';

    const headerHtml = ro ? `<div style="font-size: 11px; color: #999; padding: 4px 0 8px;">当前使用远程服务模型</div>` : '';

    return `
      <div class="model-selector">
        ${headerHtml}
        <div class="model-options" style="border: 1px solid #e8e8e8; border-radius: 8px; padding: 0 12px;">
          ${modelOptionsHtml}
          ${customOptionHtml}
        </div>
      </div>
    `;
  }

  /**
   * 绑定事件
   */
  bindEvents(container: HTMLElement): void {
    // 远程模式：radio 全部 disabled，不绑定事件
    if (this.isRemoteMode) return;

    const radios = container.querySelectorAll('input[name="aiModel"]');
    
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        this.selectedModelId = target.value;
        
        // 显示/隐藏自定义模型 URL 输入框
        const urlContainer = container.querySelector('#customModelUrlContainer') as HTMLElement;
        if (urlContainer) {
          urlContainer.style.display = this.selectedModelId === 'custom' ? 'block' : 'none';
        }
        
        // 触发回调
        this.onModelChange?.(this.selectedModelId);
      });
    });
    
    // 绑定自定义模型 URL 输入框事件
    const customUrlInput = container.querySelector('#customModelUrl') as HTMLInputElement;
    if (customUrlInput) {
      customUrlInput.addEventListener('input', (e) => {
        this.customModelUrl = (e.target as HTMLInputElement).value;
      });
    }
  }

  /**
   * 获取选中的模型 ID
   */
  getSelectedModelId(): string | null {
    return this.selectedModelId;
  }

  /**
   * 获取自定义模型的 URL
   */
  getCustomModelUrl(): string {
    return this.customModelUrl;
  }

  /**
   * 设置选中的模型 ID
   */
  setSelectedModelId(modelId: string): void {
    this.selectedModelId = modelId;
  }
}
