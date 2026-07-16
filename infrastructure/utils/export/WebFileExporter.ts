import type { IFileExporter, ExportResult, ExportOptions, ExportCapabilities } from './IFileExporter.js';

/**
 * Web 端文件导出器
 * - Web 环境：使用 `<a>` 标签触发下载
 * - App 环境：通过 prompt('file:save:...') 桥接调用原生 SAF 保存
 */
export class WebFileExporter implements IFileExporter {
  async exportText(content: string, filename: string, options?: ExportOptions): Promise<ExportResult> {
    const mimeType = options?.mimeType || 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mimeType });
    return this.exportBlob(blob, filename, options);
  }

  async exportBlob(data: Blob | ArrayBuffer, filename: string, options?: ExportOptions): Promise<ExportResult> {
    try {
      const blob = data instanceof ArrayBuffer ? new Blob([data]) : data;

      // 检测是否在 App 环境
      if (this.isAppEnvironment()) {
        return this.exportViaBridge(blob, filename);
      }

      // Web 环境：使用 <a> 标签下载
      return this.legacyDownload(blob, filename);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '导出失败' };
    }
  }

  async exportBase64(base64: string, filename: string, mimeType?: string, options?: ExportOptions): Promise<ExportResult> {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType || 'application/octet-stream' });
    return this.exportBlob(blob, filename, options);
  }

  async exportJSON(data: unknown, filename: string, options?: ExportOptions): Promise<ExportResult> {
    const content = JSON.stringify(data, null, 2);
    const name = filename.endsWith('.json') ? filename : `${filename}.json`;
    return this.exportText(content, name, { ...options, mimeType: 'application/json' });
  }

  isAvailable(): boolean {
    return typeof document !== 'undefined' && typeof URL !== 'undefined';
  }

  getCapabilities(): ExportCapabilities {
    return {
      text: true,
      binary: true,
      share: typeof navigator.share === 'function',
      pickLocation: this.isAppEnvironment(), // App 环境支持 SAF 选择位置
      maxFileSize: 1024 * 1024 * 500, // ~500MB
    };
  }

  // ========== 私有方法 ==========

  /**
   * 检测是否在 App 环境
   */
  private isAppEnvironment(): boolean {
    return typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
  }

  /**
   * 通过 prompt 桥接调用原生保存
   */
  private async exportViaBridge(blob: Blob, filename: string): Promise<ExportResult> {
    try {
      // 将 Blob 转换为 Base64
      const base64 = await this.blobToBase64(blob);

      // 调用原生桥接
      const request = JSON.stringify({
        filename,
        content: base64,
        mimeType: blob.type || 'application/octet-stream',
      });
      const response = prompt(`file:save:${request}`);

      if (!response) {
        return { success: false, error: '导出取消' };
      }

      const result = JSON.parse(response);
      if (result.error) {
        return { success: false, error: result.error };
      }

      return { success: true, path: result.path || filename };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '桥接调用失败' };
    }
  }

  /**
   * 将 Blob 转换为 Base64 字符串
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        // data:[mimeType];base64,<data>
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Blob 转换失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 传统下载方式（Web 环境）
   */
  private async legacyDownload(blob: Blob, filename: string): Promise<ExportResult> {
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, path: filename };
  }
}
