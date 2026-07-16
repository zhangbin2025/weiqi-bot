/**
 * 认证页面
 * @module presentation/pages/auth/AuthPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, PageParams } from '../../../../core/interfaces/IPage';
import type { ICard } from '../../../../core/interfaces/ICard';
import type { IDialog } from '../../../../core/interfaces/IDialog';
import type { IToast } from '../../../../core/interfaces/IToast';
import type { IAuthManager } from '../../../../../infrastructure/auth/IAuthManager';
/** 认证页面配置 */
export interface IAuthPageConfig {
  /** 认证管理器 */
  authManager: IAuthManager;
  /** 日志记录器 */
  /** 返回 URL */
  returnUrl?: string;
  /** 导航回调 */
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
/**
 * 认证页面
 * 适配多运行环境（Web/Terminal/Node.js）
 */
export class AuthPage implements IPage {
  readonly title = '认证';
  private authManager: IAuthManager;
  private returnUrl: string;
  private onNavigate: ((page: string, params?: Record<string, string>) => void) | undefined;
  private card: ICard;
  private dialog: IDialog;
  private toast: IToast;
  constructor(config: IAuthPageConfig) {
    this.authManager = config.authManager;
    this.returnUrl = config.returnUrl ?? '/';
    this.onNavigate = config.onNavigate;
    this.card = AdapterFactory.createCard();
    this.dialog = AdapterFactory.createDialog();
    this.toast = AdapterFactory.createToast();
  }
  /** 初始化 */
  async initialize(): Promise<void> {
    // 已认证则直接跳转
    if (this.authManager.hasToken()) {
      this.redirectBack();
      return;
    }
    this.render();
  }
  /** 处理 URL 参数 */
  handleParams(params: PageParams): void {
    // 处理回调 token
    if (params['token']) {
      this.handleCallback(params['token']);
    }
    if (params['return']) {
      this.returnUrl = decodeURIComponent(params['return']);
    }
  }
  /** 处理登录 */
  async handleLogin(): Promise<void> {
    try {
      this.toast.info('正在跳转登录...');
      // 获取登录 URL
      const apiBase = await this.authManager.getApiBase();
      const currentUrl = this.getCurrentUrl();
      const loginUrl = `${apiBase}/auth/login?redirect=${encodeURIComponent(currentUrl)}`;
      // 通过导航或外部跳转
      if (this.onNavigate) {
        this.onNavigate('external', { url: loginUrl });
      } else {
        // Fallback: 通知用户手动访问
        this.card.setContent([
          '请访问以下链接登录：',
          '',
          loginUrl,
        ].join('\n'));
        this.card.render();
      }
    } catch (error) {
      console.error('登录失败', error as Error);
      this.toast.error('登录失败');
    }
  }
  /** 处理回调 */
  async handleCallback(token: string): Promise<void> {
    this.toast.info('正在验证...');
    try {
      this.authManager.saveToken(token);
      const valid = await this.authManager.validateToken();
      if (valid) {
        this.toast.success('认证成功');
        this.redirectBack();
      } else {
        await this.dialog.show({
          type: 'alert',
          title: '认证失败',
          content: 'Token 无效或已过期，请重试',
        });
        this.render();
      }
    } catch (error) {
      console.error('验证失败', error as Error);
      this.toast.error('验证失败');
      this.render();
    }
  }
  /** 获取当前 URL */
  private getCurrentUrl(): string {
    // 尝试获取当前 URL（浏览器环境）
    if (typeof window !== 'undefined' && window.location) {
      return window.location.href;
    }
    // 非浏览器环境返回占位
    return '/auth';
  }
  /** 跳转回原页面 */
  private redirectBack(): void {
    if (this.onNavigate) {
      this.onNavigate(this.returnUrl);
    } else {
      this.toast.info(`即将跳转到 ${this.returnUrl}`);
    }
  }
  /** 渲染 */
  render(): void {
    this.card.setContent([
      '🔐 登录认证',
      '',
      '请登录以访问该功能',
      '',
      '点击 [登录] 继续',
    ].join('\n'));
    this.card.render();
  }
  /** 销毁 */
  destroy(): void {
    this.card.destroy();
    this.dialog.destroy();
    this.toast.destroy();
  }
}
