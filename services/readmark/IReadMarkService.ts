/**
 * 已读标记服务接口
 */

export interface IReadMarkService {
  /** 标记已读 */
  markRead(category: string, id: string): Promise<void>;
  
  /** 批量标记已读 */
  markReadBatch(category: string, ids: string[]): Promise<void>;
  
  /** 是否已读 */
  isRead(category: string, id: string): Promise<boolean>;
  
  /** 获取某分类下所有已读ID */
  getReadMarks(category: string): Promise<string[]>;
  
  /** 清除某分类下所有已读标记 */
  clearReadMarks(category: string): Promise<void>;
}
