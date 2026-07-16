/**
 * 终端卡片组件
 * @description 实现 ICard 接口，输出 ANSI 格式到 stdout
 * @module presentation/adapters/cli/components/Card
 */
import type { ICard, ICardConfig } from '../../../core/interfaces';
/**
 * 终端卡片
 * 将内容输出到标准输出，支持编号列表用于收藏选择
 */
export class TerminalCard implements ICard {
  private titleText = '';
  private contentText = '';
  private actionCb?: (action: string, data?: Record<string, string>) => void;
  private bookmarkNames: string[] = [];
  setTitle(title: string): void {
    this.titleText = title;
  }
  setContent(content: string): void {
    this.contentText = content;
    this.bookmarkNames = this.parseBookmarkNames(content);
  }
  setSubtitle(_subtitle: string): void {
    // unused in terminal
  }
  setConfig(_config: ICardConfig): void {
    // unused in terminal
  }
  onClick(_callback: () => void): void {
    // unused in terminal
  }
  onAction(callback: (action: string, data?: Record<string, string>) => void): void {
    this.actionCb = callback;
  }
  /**
   * 用户输入编号时调用
   */
  handleSelect(index: number): void {
    const name = this.bookmarkNames[index - 1];
    if (name) {
      this.actionCb?.('viewHistory', { name });
    }
  }
  /**
   * 获取收藏名字列表
   */
  getBookmarkNames(): string[] {
    return [...this.bookmarkNames];
  }
  render(): void {
    if (this.titleText) {
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`\x1b[1m${this.titleText}\x1b[0m`);
      console.log('─'.repeat(40));
    }
    if (this.contentText) {
      console.log(this.contentText);
    }
  }
  setVisible(_visible: boolean): void {
    // Terminal cards don't have visibility state
  }
  destroy(): void {
    this.titleText = '';
    this.contentText = '';
    this.bookmarkNames = [];
  }
  private parseBookmarkNames(content: string): string[] {
    const names: string[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/👤\s*(\S+)/);
      if (match) {
        names.push(match[1]!);
      }
    }
    return names;
  }
}
