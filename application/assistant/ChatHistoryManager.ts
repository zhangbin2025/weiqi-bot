/**
 * 聊天历史管理器
 * @description 管理聊天会话历史，使用 FavoriteService 存储
 */
import type { IFavoriteService } from '../../services/favorite/IFavoriteService';
/** 聊天消息 */
export interface ChatMessage {
  /** 角色 */
  role: 'user' | 'assistant';
  /** 消息内容 */
  content: string;
  /** 识别的意图 */
  intent?: string;
  /** 提取的实体 */
  entities?: Record<string, unknown>;
  /** 任务 ID（用于后台任务消息） */
  taskId?: string;
  /** 任务是否已完成（避免重复查询） */
  taskCompleted?: boolean;
  /** 跳转 URL（如果有） */
  actionUrl?: string;
  /** 跳转按钮文本 */
  actionText?: string;
  /** 时间戳 */
  timestamp: number;
}
/** 会话数据 */
export interface ChatSessionData {
  /** 会话标题 */
  title: string;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}
/** 会话项 */
export interface ChatSession {
  /** 收藏 ID */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 会话数据 */
  data: ChatSessionData;
  /** 备注 */
  note?: string | undefined;
}
/**
 * 聊天历史管理器
 */
export class ChatHistoryManager {
  private readonly favoriteService: IFavoriteService;
  private readonly category = 'chat-session';
  private currentSessionId: string | null = null;
  private currentMessages: ChatMessage[] = [];
  constructor(favoriteService: IFavoriteService) {
    this.favoriteService = favoriteService;
  }
  /**
   * 创建新会话
   */
  async createSession(title?: string): Promise<string> {
    const sessionId = `session:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    this.currentSessionId = sessionId;
    this.currentMessages = [];
    // 保存到收藏
    await this.favoriteService.addFavorite(
      this.category,
      sessionId,
      {
        title: title || this.generateTitle(),
        messages: [],
        createdAt: now,
        updatedAt: now,
      }
    );
    return sessionId;
  }
  /**
   * 获取当前会话
   */
  getCurrentSession(): { sessionId: string; messages: ChatMessage[] } | null {
    if (!this.currentSessionId) return null;
    return {
      sessionId: this.currentSessionId,
      messages: this.currentMessages,
    };
  }
  /**
   * 获取所有会话
   */
  async getAllSessions(): Promise<ChatSession[]> {
    const favorites = await this.favoriteService.getFavorites({ category: this.category });
    return favorites.map(fav => ({
      id: fav.id,
      sessionId: fav.key,
      data: (fav.data as unknown as ChatSessionData),
      note: fav.note,
    }));
  }
  /**
   * 加载会话
   */
  async loadSession(sessionId: string): Promise<ChatMessage[] | null> {
    const favorite = await this.favoriteService.getFavorite(this.category, sessionId);
    if (!favorite) return null;
    this.currentSessionId = sessionId;
    this.currentMessages = ((favorite.data as unknown) as ChatSessionData).messages || [];
    return this.currentMessages;
  }
  /**
   * 添加消息到当前会话
   */
  async addMessage(message: Omit<ChatMessage, 'timestamp'>): Promise<void> {
    if (!this.currentSessionId) {
      await this.createSession();
    }
    const fullMessage: ChatMessage = {
      ...message,
      timestamp: Date.now(),
    };
    this.currentMessages.push(fullMessage);
    // 更新会话
    await this.saveCurrentSession();
  }
  
  /**
   * 更新最后一条 assistant 消息
   * 
   * @deprecated 已废弃，请使用 updateMessageByTaskId
   */
  async updateLastAssistantMessage(newContent: string): Promise<void> {
    if (!this.currentSessionId || this.currentMessages.length === 0) {
      return;
    }
    
    // 找到最后一条 assistant 消息
    for (let i = this.currentMessages.length - 1; i >= 0; i--) {
      if (this.currentMessages[i]!.role === 'assistant') {
        this.currentMessages[i]!.content = newContent;
        this.currentMessages[i]!.timestamp = Date.now();
        break;
      }
    }
    
    // 保存更新
    await this.saveCurrentSession();
  }
  
  /**
   * 根据 taskId 更新消息内容（全量更新）
   * 
   * 这是唯一的更新消息历史的方法，确保全量读取、局部修改、全量写入
   * 
   * @param taskId 任务 ID
   * @param newContent 新的消息内容
   * @param taskCompleted 任务是否已完成（可选）
   * @returns 是否找到并更新了消息
   */
  async updateMessageByTaskId(taskId: string, newContent: string, taskCompleted?: boolean): Promise<boolean> {
    if (!this.currentSessionId) {
      return false;
    }
    
    // 遍历所有消息，找到匹配的消息
    let found = false;
    for (let i = 0; i < this.currentMessages.length; i++) {
      if (this.currentMessages[i]!.taskId === taskId) {
        this.currentMessages[i]!.content = newContent;
        // 如果提供了 taskCompleted 参数，更新该字段
        if (taskCompleted !== undefined) {
          this.currentMessages[i]!.taskCompleted = taskCompleted;
        }
        // 不更新时间戳，保持原始时间，避免消息乱序
        // this.currentMessages[i]!.timestamp = Date.now();
        found = true;
        break;
      }
    }
    
    if (found) {
      // 保存更新（全量写回）
      await this.saveCurrentSession();
    }
    
    return found;
  }
  
  /**
   * 检查 taskId 是否存在于当前会话的消息中
   * 
   * @param taskId 任务 ID
   * @returns 是否存在
   */
  hasTaskId(taskId: string): boolean {
    if (!this.currentSessionId || this.currentMessages.length === 0) {
      return false;
    }
    
    return this.currentMessages.some(msg => msg.taskId === taskId);
  }
  
  /**
   * 获取当前会话的所有消息
   * 
   * @returns 消息列表
   */
  getMessages(): ChatMessage[] {
    return this.currentMessages;
  }
  
  /**
   * 保存当前会话
   */
  private async saveCurrentSession(): Promise<void> {
    if (!this.currentSessionId) return;
    const existing = await this.favoriteService.getFavorite(this.category, this.currentSessionId);
    const existingData = existing?.data ? (existing.data as unknown as ChatSessionData) : undefined;
    
    await this.favoriteService.addFavorite(
      this.category,
      this.currentSessionId,
      {
        title: existingData?.title || this.generateTitle(),
        messages: this.currentMessages,
        createdAt: existingData?.createdAt || Date.now(),
        updatedAt: Date.now(),
      }
    );
  }
  /**
   * 生成会话标题
   */
  private generateTitle(): string {
    if (this.currentMessages.length === 0) {
      return '新对话';
    }
    // 用第一条用户消息作为标题（最多20字）
    const firstUserMsg = this.currentMessages.find(m => m.role === 'user');
    if (firstUserMsg) {
      return firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '');
    }
    return '新对话';
  }
  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const favorite = await this.favoriteService.getFavorite(this.category, sessionId);
    if (favorite) {
      await this.favoriteService.removeFavorite(favorite.id);
    }
    // 如果删除的是当前会话，清空
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
      this.currentMessages = [];
    }
  }
  /**
   * 清空所有会话
   */
  async clearAll(): Promise<void> {
    await this.favoriteService.clear(this.category);
    this.currentSessionId = null;
    this.currentMessages = [];
  }
  /**
   * 更新会话备注
   */
  async updateNote(sessionId: string, note: string): Promise<void> {
    const favorite = await this.favoriteService.getFavorite(this.category, sessionId);
    if (favorite) {
      await this.favoriteService.updateNote(favorite.id, note);
    }
  }
  /**
   * 统计会话数量
   */
  async count(): Promise<number> {
    return await this.favoriteService.count(this.category);
  }
}
