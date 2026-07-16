/**
 * Web 二维码对话框组件
 * @module presentation/adapters/web/components/QRCodeDialog
 */
import type { IQRGenerator } from '../../../../infrastructure/utils/share/IQRGenerator';
import { WebQRGenerator } from '../../../../infrastructure/utils/share/WebQRGenerator';
/**
 * 二维码对话框配置
 */
export interface QRCodeDialogConfig {
  /** 标题 */
  title?: string;
  /** 提示文字 */
  hint?: string;
  /** 自定义二维码生成器（可选，默认使用 WebQRGenerator） */
  qrGenerator?: IQRGenerator;
}
/**
 * 二维码对话框组件
 * @description 公共二维码弹窗组件，使用基础设施层 WebQRGenerator 生成二维码
 */
export class WebQRCodeDialog {
  private modalId = `qr-dialog-${Date.now()}`;
  private containerId = `qr-container-${Date.now()}`;
  private config: QRCodeDialogConfig;
  private qrGenerator: IQRGenerator;
  constructor(config?: QRCodeDialogConfig) {
    this.config = config ?? {
      title: '扫码分享',
      hint: '截图或长按二维码识别',
    };
    this.qrGenerator = config?.qrGenerator ?? new WebQRGenerator();
  }
  /**
   * 显示二维码对话框
   * @param url - 二维码内容 URL
   */
  async show(url: string): Promise<void> {
    // 创建对话框
    this.createDialog();
    // 使用 WebQRGenerator 生成二维码
    const container = document.getElementById(this.containerId);
    if (container) {
      try {
        await this.qrGenerator.generate(container, url, {
          width: 200,
          height: 200,
          colorDark: '#333',
          colorLight: '#fff',
        });
      } catch (e) {
        container.innerHTML = '<div style="color:#c53030; font-size:13px;">二维码生成失败</div>';
      }
    }
    // 显示
    const modal = document.getElementById(this.modalId);
    if (modal) {
      modal.style.display = 'flex';
    }
  }
  /**
   * 隐藏对话框
   */
  hide(): void {
    const modal = document.getElementById(this.modalId);
    if (modal) {
      modal.style.display = 'none';
      modal.remove();
    }
  }
  /**
   * 销毁组件
   */
  destroy(): void {
    this.hide();
  }
  private createDialog(): void {
    // 如果已存在则先移除
    const existing = document.getElementById(this.modalId);
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.id = this.modalId;
    div.innerHTML = this.renderHTML();
    document.body.appendChild(div);
    // 绑定关闭事件
    div.addEventListener('click', (e) => {
      if (e.target === div) this.hide();
    });
    div.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action="close-qr"]');
      if (target) this.hide();
    });
  }
  private renderHTML(): string {
    return `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
      ">
        <div style="
          background: white;
          padding: 24px;
          border-radius: 16px;
          text-align: center;
          max-width: 300px;
          width: 90%;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        ">
          <div style="
            font-size: 18px;
            color: #333;
            margin-bottom: 20px;
            font-weight: 600;
          ">${this.config.title}</div>
          <div id="${this.containerId}" style="
            display: flex;
            justify-content: center;
            align-items: center;
          "></div>
          <div style="
            font-size: 13px;
            color: #666;
            margin-top: 16px;
            line-height: 1.6;
          ">${this.config.hint}</div>
          <div data-action="close-qr" style="
            margin-top: 20px;
            padding: 12px 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 24px;
            font-size: 14px;
            cursor: pointer;
            display: inline-block;
            transition: transform 0.2s;
          " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">关闭</div>
        </div>
      </div>
    `;
  }
}
