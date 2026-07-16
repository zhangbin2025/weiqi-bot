/**
 * 定式列表已读标记管理器
 * @description 处理已读标记的加载、标记、清除
 */
import type { IReadMarkService } from '../../../../../../services/readmark';
/**
 * 已读标记管理器
 */
export class JosekiReadMarkManager {
  private readMarkIds: string[] = [];
  private currentCategory: string | undefined;
  constructor(private readonly readMarkService: IReadMarkService) {}
  /** 设置当前分类 */
  setCategory(category: string | undefined): void {
    this.currentCategory = category;
  }
  /** 加载已读标记 */
  async loadReadMarks(): Promise<void> {
    if (this.currentCategory) {
      this.readMarkIds = await this.readMarkService.getReadMarks(this.currentCategory);
    }
  }
  /** 标记已读 */
  async markRead(patternId: string): Promise<void> {
    if (this.currentCategory) {
      await this.readMarkService.markRead(this.currentCategory, patternId);
      if (!this.readMarkIds.includes(patternId)) {
        this.readMarkIds.push(patternId);
      }
    }
  }
  /** 清除已读标记 */
  async clearReadMarks(): Promise<void> {
    if (this.currentCategory) {
      await this.readMarkService.clearReadMarks(this.currentCategory);
      this.readMarkIds = [];
    }
  }
  /** 检查是否已读 */
  isRead(patternId: string): boolean {
    return this.readMarkIds.includes(patternId);
  }
  /** 获取所有已读标记 */
  getReadMarkIds(): string[] {
    return this.readMarkIds;
  }
  /** 重置 */
  reset(): void {
    this.readMarkIds = [];
    this.currentCategory = undefined;
  }
}
