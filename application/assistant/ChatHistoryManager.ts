/**
 * 聊天历史管理器
 * @description 管理聊天会话历史，使用 FavoriteService 存储
 */
import type { IFavoriteService } from '../../services/favorite/IFavoriteService';
import type { ChatAttachment } from '../chat/ChatAttachment';
/** 聊天消息 */
export interface ChatMessage {
  /** 角色 */
  role: 'user' | 'assistant';
  /** 消息内容（纯文本，附件绝不塞进来：否则 markdown/标题/URL 卡片会误伤 base64） */
  content: string;
  /**
   * 随消息落历史的资源附件（PDF 抽取文字 / 原生 PDF / 图片 base64）。
   * 2026-11-13 决策：落历史以支持多轮追问；字符预算只管 content，
   * 附件随所在消息受 maxMessages 窗口约束，不另设字节上限。
   */
  attachments?: ChatAttachment[];
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
  /** 消息变体：'chat' 表示 LLM 闲聊回复，仅用于渲染时显示「聊天」意图标识（不影响分类/跳转规则） */
  variant?: 'chat';
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
  /**
   * 会话绑定的模型角色 id（见 application/chat/ChatRole）。
   * 可选：老会话没有此字段时按默认角色（闲聊）处理，向后兼容。
   * 角色归属会话数据本身，不放在页面侧 localStorage —— 否则换设备、
   * 清缓存或从历史列表打开时可能弄错角色。
   */
  role?: string;
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
  private readonly category: string;
  private currentSessionId: string | null = null;
  private currentMessages: ChatMessage[] = [];
  /**
   * @param category 会话存储分类。功能助手用默认 'chat-session'；
   *   独立对话页传 'chat-conversation'，两套会话互不干扰，导出/清空天然隔离。
   */
  constructor(favoriteService: IFavoriteService, category: string = 'chat-session') {
    this.favoriteService = favoriteService;
    this.category = category;
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
   * 把工具本轮读到的资源附件补写进「最后一条 user 消息」。
   *
   * 时序说明：用户消息在发模型前就已落盘（buildConversationMessages 要读），
   * 而工具附件直到 agent loop 跑完才知道。补写是为了**下一轮追问**能重放这些
   * 资源（用户决策第 6 点），本轮 loop 内部已自行把 parts 追加进内存消息。
   * 多次调用是合并语义，不覆盖用户原有附件。
   */
  async appendAttachmentsToLastUser(attachments: ChatAttachment[]): Promise<void> {
    if (!this.currentSessionId || attachments.length === 0) return;
    for (let i = this.currentMessages.length - 1; i >= 0; i--) {
      const msg = this.currentMessages[i]!;
      if (msg.role === 'user') {
        const existing = msg.attachments ?? [];
        // exactOptionalPropertyTypes：只在真的有合并结果时写字段
        msg.attachments = [...existing, ...attachments];
        await this.saveCurrentSession();
        return;
      }
    }
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
        // 角色是会话固有属性，重建 data 时必须保留，否则发一条消息就丢了
        ...(existingData?.role ? { role: existingData.role } : {}),
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
   * 设置当前会话标题（对话页在写入首条消息后用「第一条 user 消息截断」更新）。
   * 保留 createdAt，避免改变会话排序。
   */
  async setCurrentSessionTitle(title: string): Promise<void> {
    if (!this.currentSessionId) return;
    const existing = await this.favoriteService.getFavorite(this.category, this.currentSessionId);
    const existingData = existing?.data ? (existing.data as unknown as ChatSessionData) : undefined;
    await this.favoriteService.addFavorite(
      this.category,
      this.currentSessionId,
      {
        title,
        messages: this.currentMessages,
        createdAt: existingData?.createdAt || Date.now(),
        updatedAt: Date.now(),
        ...(existingData?.role ? { role: existingData.role } : {}),
      },
    );
  }

  /**
   * 设置当前会话的模型角色。角色一旦确定就写入会话数据，
   * 后续 addMessage / 改标题 / 清空消息都会保留它。
   */
  async setCurrentSessionRole(role: string): Promise<void> {
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
        role,
      },
    );
  }

  /**
   * 清空「当前会话」的消息，保留会话本身（空会话）。
   * 与功能助手的 clearAll()（清空全部会话）区分，供对话页菜单使用。
   */
  async clearCurrentSession(): Promise<void> {
    if (!this.currentSessionId) return;
    const existing = await this.favoriteService.getFavorite(this.category, this.currentSessionId);
    const existingData = existing?.data ? (existing.data as unknown as ChatSessionData) : undefined;
    this.currentMessages = [];
    await this.favoriteService.addFavorite(
      this.category,
      this.currentSessionId,
      {
        title: '新对话',
        messages: [],
        createdAt: existingData?.createdAt || Date.now(),
        updatedAt: Date.now(),
        // 清空消息不改角色：会话的角色归属是固定的
        ...(existingData?.role ? { role: existingData.role } : {}),
      },
    );
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
