/**
 * 文件导出器接口
 * @module infrastructure/utils/export/IFileExporter
 */

/** 导出结果 */
export interface ExportResult {
  /** 是否成功 */
  success: boolean;
  /** 目标路径（成功时） */
  path?: string;
  /** 错误信息（失败时） */
  error?: string;
}

/** 导出选项 */
export interface ExportOptions {
  /** MIME 类型 */
  mimeType?: string;
  /** 是否静默（不显示提示） */
  silent?: boolean;
  /** 标题（用于分享/保存对话框） */
  title?: string;
}

/** 导出能力描述 */
export interface ExportCapabilities {
  /** 是否支持文本导出 */
  text: boolean;
  /** 是否支持二进制导出 */
  binary: boolean;
  /** 是否支持分享 */
  share: boolean;
  /** 是否支持选择保存位置 */
  pickLocation: boolean;
  /** 最大文件大小（字节），-1 表示无限制 */
  maxFileSize: number;
}

/** 文件导出器接口 */
export interface IFileExporter {
  /**
   * 导出文本内容
   */
  exportText(content: string, filename: string, options?: ExportOptions): Promise<ExportResult>;

  /**
   * 导出二进制数据
   */
  exportBlob(data: Blob | ArrayBuffer, filename: string, options?: ExportOptions): Promise<ExportResult>;

  /**
   * 导出 Base64 数据
   */
  exportBase64(base64: string, filename: string, mimeType?: string, options?: ExportOptions): Promise<ExportResult>;

  /**
   * 导出 JSON 对象
   */
  exportJSON(data: unknown, filename: string, options?: ExportOptions): Promise<ExportResult>;

  /**
   * 检查导出能力是否可用
   */
  isAvailable(): boolean;

  /**
   * 获取导出能力描述
   */
  getCapabilities(): ExportCapabilities;
}