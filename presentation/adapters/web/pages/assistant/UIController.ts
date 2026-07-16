/**
 * UI 控制器
 * @module presentation/adapters/web/pages/assistant/UIController
 */
import type { IAssistantUseCase } from '../../../../../application/assistant/IAssistantUseCase';
import type { ISessionService } from '../../../../../services/session/ISessionService';
import type { IManagementService, ManagementCommand } from '../../../../../services/management/IManagementService';
import { ClipboardHandler } from './ClipboardHandler';
import { buildArchiveUrl } from '../../../../../domain/sgf/SGFUtils';
/**
 * UI 控制器配置
 */
export interface UIControllerConfig {
  useCase: IAssistantUseCase;
  onSendMessage: (text: string) => Promise<void>;
  sessionService?: ISessionService; // 可选的 SessionService
  managementService: IManagementService; // 管理服务
}
/**
 * UI 控制器
 * 管理 UI 交互和事件监听
 */
export class UIController {
  private useCase: IAssistantUseCase;
  private onSendMessage: (text: string) => Promise<void>;
  private clipboardHandler: ClipboardHandler;
  private sessionService: ISessionService | undefined; // SessionService 实例（可选）
  private managementService: IManagementService; // 管理服务
  private availableCommands: ManagementCommand[] = []; // 可用命令列表
  
  constructor(config: UIControllerConfig) {
    this.useCase = config.useCase;
    this.onSendMessage = config.onSendMessage;
    this.sessionService = config.sessionService; // 接收 SessionService
    this.managementService = config.managementService; // 接收管理服务
    this.clipboardHandler = new ClipboardHandler();
    
    // 初始化可用命令列表
    this.availableCommands = this.managementService.getAvailableCommands();
  }
  /**
   * 初始化事件监听
   */
  init(): void {
    this.bindInputEvents();
    this.bindGlobalFunctions();
  }
  /**
   * 启用输入
   */
  enableInput(): void {
    const input = document.getElementById('userInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
  }
  /**
   * 切换指令菜单
   */
  toggleCommandMenu(): void {
    const menu = document.getElementById('commandMenu');
    const overlay = document.getElementById('commandMenuOverlay');
    if (menu && overlay) {
      const isVisible = menu.style.display === 'block';
      menu.style.display = isVisible ? 'none' : 'block';
      overlay.style.display = isVisible ? 'none' : 'block';
    }
  }
  /**
   * 选择指令
   */
  selectCommand(text: string): void {
    this.toggleCommandMenu(); // 关闭菜单
    const input = document.getElementById('userInput') as HTMLTextAreaElement;
    if (input) {
      input.value = text;
      this.autoResizeTextarea(input);
    }
    // 延迟一点发送，让用户看到输入的内容
    setTimeout(() => {
      this.sendMessage();
    }, 100);
  }
  /**
   * 发送消息
   */
  sendMessage(): void {
    const input = document.getElementById('userInput') as HTMLTextAreaElement;
    const text = input?.value?.trim();
    if (!text) return;
    // 清空输入框
    if (input) {
      input.value = '';
      this.autoResizeTextarea(input);
    }
    // 调用回调
    this.onSendMessage(text);
  }
  /**
   * 自动调整 textarea 高度
   */
  autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
  }
  
  /**
   * 显示命令补全菜单
   */
  showCommandSuggest(input: string): void {
    const suggest = document.getElementById('commandSuggest');
    if (!suggest) return;
    
    // 检查是否是命令开头
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      this.hideCommandSuggest();
      return;
    }
    
    // 过滤匹配的命令
    const matched = this.availableCommands.filter(cmd => 
      cmd.command.toLowerCase().startsWith(trimmed.toLowerCase())
    );
    
    if (matched.length === 0) {
      this.hideCommandSuggest();
      return;
    }
    
    // 渲染命令列表
    suggest.innerHTML = matched.map(cmd => `
      <div class="command-suggest-item" data-command="${cmd.command}">
        <div class="command-suggest-icon">${cmd.icon}</div>
        <div class="command-suggest-content">
          <div class="command-suggest-title">${cmd.title}</div>
          <div class="command-suggest-desc">${cmd.description}</div>
        </div>
      </div>
    `).join('');
    
    // 绑定点击事件
    suggest.querySelectorAll('.command-suggest-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const command = (e.currentTarget as HTMLElement).dataset['command'];
        if (command) {
          this.selectCommandSuggest(command);
        }
      });
    });
    
    // 显示菜单
    suggest.classList.add('show');
  }
  
  /**
   * 隐藏命令补全菜单
   */
  hideCommandSuggest(): void {
    const suggest = document.getElementById('commandSuggest');
    if (suggest) {
      suggest.classList.remove('show');
    }
  }
  
  /**
   * 选择命令补全项
   */
  selectCommandSuggest(command: string): void {
    const input = document.getElementById('userInput') as HTMLTextAreaElement;
    if (input) {
      input.value = command;
      this.autoResizeTextarea(input);
      this.hideCommandSuggest();
    }
  }
  /**
   * 绑定输入事件
   */
  private bindInputEvents(): void {
    // 监听 textarea 输入，自动调整高度 + 命令补全
    document.getElementById('userInput')?.addEventListener('input', (e) => {
      const textarea = e.target as HTMLTextAreaElement;
      this.autoResizeTextarea(textarea);
      
      // 命令补全
      const value = textarea.value;
      if (value.startsWith('/')) {
        this.showCommandSuggest(value);
      } else {
        this.hideCommandSuggest();
      }
    });
    
    // 回车发送（Shift+Enter 换行）
    document.getElementById('userInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.hideCommandSuggest(); // 隐藏命令补全菜单
        this.sendMessage();
      }
      
      // ESC 关闭命令补全菜单
      if (e.key === 'Escape') {
        this.hideCommandSuggest();
      }
    });
    
    // 监听焦点，检查剪贴板
    document.getElementById('userInput')?.addEventListener('focus', async () => {
      const input = document.getElementById('userInput') as HTMLTextAreaElement;
      if (input && !input.value.trim()) {
        await this.clipboardHandler.checkClipboard(input);
      }
    });
    
    // 失去焦点时隐藏命令补全菜单（延迟，避免点击事件无法触发）
    document.getElementById('userInput')?.addEventListener('blur', () => {
      setTimeout(() => {
        this.hideCommandSuggest();
      }, 200);
    });
    
    // SGF 文件上传处理
    document.getElementById('sgfUpload')?.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file && file.name.endsWith('.sgf')) {
        try {
          const text = await file.text();
          // 发送消息（包含 SGF 内容）
          await this.onSendMessage(text);
        } catch (error) {
          console.error('读取 SGF 文件失败:', error);
          await this.onSendMessage('抱歉，读取 SGF 文件失败，请检查文件格式。');
        }
      }
      // 清空 input，允许重复上传同一文件
      input.value = '';
    });
  }
  /**
   * 绑定全局函数
   */
  private bindGlobalFunctions(): void {
    (window as any).quickSend = (text: string) => {
      const input = document.getElementById('userInput') as HTMLTextAreaElement;
      if (input) {
        input.value = text;
        this.autoResizeTextarea(input);
      }
      this.sendMessage();
    };
    (window as any).sendMessage = () => this.sendMessage();
    (window as any).toggleCommandMenu = () => this.toggleCommandMenu();
    (window as any).selectCommand = (text: string) => this.selectCommand(text);
    (window as any).newSession = () => this.useCase.newSession();
    (window as any).showHistory = () => this.useCase.showHistory();
    (window as any).clearAllHistory = () => this.useCase.clearAllHistory();
    (window as any).exportHistory = () => this.useCase.exportHistory();
  }
}
