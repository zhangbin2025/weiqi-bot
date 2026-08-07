/**
 * 剪贴板处理器
 * @module presentation/adapters/web/pages/assistant/ClipboardHandler
 */

import { EntityValidator } from '../../../../../domain/intent/EntityValidator';

/**
 * 剪贴板处理器
 * 处理剪贴板内容检测和提示
 *
 * 适配两种环境：
 * 1. 原生 GeckoView：通过 prompt("clipboard:read") 桥接读取 Android 原生剪贴板
 * 2. 普通浏览器：通过 navigator.clipboard.readText() 读取
 */
export class ClipboardHandler {
  /** 上次处理的剪贴板文本，避免重复触发 */
  private lastClipboardText: string = '';
  /**
   * 检查剪贴板内容
   * @param inputElement 输入框元素
   */
  async checkClipboard(inputElement: HTMLTextAreaElement | null): Promise<void> {
    try {
      const text = await this.readClipboardText();
      if (!text || !text.trim()) {
        return;
      }
      const trimmedText = text.trim();
      // 避免与上次内容重复
      if (trimmedText === this.lastClipboardText) {
        return;
      }
      // 检查是否是 URL
      if (this.isUrl(trimmedText)) {
        this.lastClipboardText = trimmedText;
        this.autoFill(inputElement, trimmedText);
        return;
      }
      // 检查是否是 SGF 格式
      if (this.isSgf(trimmedText)) {
        this.lastClipboardText = trimmedText;
        this.autoFill(inputElement, trimmedText);
        return;
      }
      // 检查是否是人名
      if (this.isPersonName(trimmedText)) {
        this.lastClipboardText = trimmedText;
        this.autoFill(inputElement, trimmedText);
        return;
      }
      // 如果包含围棋关键词，只显示提示
      if (this.containsChessKeyword(trimmedText)) {
        if (inputElement) {
          inputElement.placeholder = '检测到剪贴板有内容，点击粘贴试试';
        }
      }
    } catch (error) {
      // 剪贴板访问被拒绝，静默失败
    }
  }
  /**
   * 读取剪贴板文本
   *
   * 原生环境通过 prompt("clipboard:read") 桥接读取 Android 原生剪贴板，
   * 浏览器环境使用 navigator.clipboard.readText()
   */
  private async readClipboardText(): Promise<string> {
    // 原生环境：通过 prompt 桥接，Android 端拦截 clipboard:read 返回剪贴板内容
    if ((window as any).__weiqi_native) {
      const result = prompt('clipboard:read');
      return result || '';
    }
    // 浏览器环境：使用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.readText) {
      return await navigator.clipboard.readText();
    }
    return '';
  }
  /**
   * 自动填充文本到输入框
   */
  private autoFill(inputElement: HTMLTextAreaElement | null, text: string): void {
    if (inputElement) {
      inputElement.value = text;
      // 触发 input 事件，以便调整高度
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      // 聚焦输入框
      inputElement.focus();
    }
  }
  /**
   * 检查是否是 URL
   * 只有整个文本是有效的 URL 时才返回 true
   */
  private isUrl(text: string): boolean {
    return EntityValidator.isUrl(text);
  }
  /**
   * 检查是否包含围棋关键词
   */
  private containsChessKeyword(text: string): boolean {
    const keywords = ['棋谱', '下载', '对局', '围棋', '野狐', 'OGS', 'sgf'];
    return keywords.some(keyword => text.includes(keyword));
  }
  /**
   * 检查是否是 SGF 格式
   * 只有整个文本是有效的 SGF 内容时才返回 true
   */
  private isSgf(text: string): boolean {
    return EntityValidator.isSgf(text);
  }
  /**
   * 检查是否是人名
   * 支持中文姓名（2-4个汉字）和常见围棋选手名字
   */
  private isPersonName(text: string): boolean {
    // 如果文本太长（超过20字符），不太可能是人名
    if (text.length > 20) {
      return false;
    }
    // 如果包含空格、换行等，不是单个名字
    if (text.includes(' ') || text.includes('\n') || text.includes('\t')) {
      return false;
    }
    // 检查是否是中文姓名（2-4个汉字）
    const chineseNameRegex = /^[\u4e00-\u9fa5]{2,4}$/;
    if (chineseNameRegex.test(text)) {
      return true;
    }
    // 检查是否包含常见围棋选手名字
    const famousPlayers = [
      '柯洁', '申真谞', '朴廷桓', '井山裕太', '李世石', '古力',
      '常昊', '孔杰', '陈耀烨', '周睿羊', '时越', '芈昱廷',
      '连笑', '范廷钰', '檀啸', '党毅飞', '谢尔豪', '杨鼎新',
      '丁浩', '李钦诚', '江维杰', '柁嘉熹', '唐韦星', '辜梓豪',
      '申旻埈', '卞相壹', '金志锡', '姜东润', '朴永训', '崔哲瀚',
      '元晟溱', '李东勋', '罗玄', '申旻埈', '卞相壹'
    ];
    return famousPlayers.some(player => text.includes(player));
  }
}
