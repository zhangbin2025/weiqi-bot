/**
 * 剪贴板接口
 * @module infrastructure/utils/clipboard/IClipboard
 */

/**
 * 剪贴板抽象接口
 */
export interface IClipboard {
  /** 读取剪贴板文本 */
  readText(): Promise<string | null>;

  /** 写入剪贴板文本 */
  writeText(text: string): Promise<void>;

  /** 检查剪贴板是否可用 */
  isAvailable(): boolean;
}
