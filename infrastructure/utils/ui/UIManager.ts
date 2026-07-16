/**
 * UI 管理器 - 统一管理不同平台的 UI 控制
 */
import type { IUIController, PageRoute, PlayMode, UIState } from './types';
import {
  WebUIController,
  ElectronUIController,
  MobileUIController,
  MiniProgramUIController,
  TerminalUIController
} from './adapters';

export class UIManager {
  private controller: IUIController;

  constructor(controller?: IUIController) {
    this.controller = controller ?? this.detectController();
  }

  private detectController(): IUIController {
    // @ts-ignore - wx 是微信小程序的全局对象
    if (typeof wx !== 'undefined') return new MiniProgramUIController();
    if (typeof process !== 'undefined' && process.versions?.['electron']) {
      return new ElectronUIController();
    }
    if (typeof window !== 'undefined' && (window as any).__MOBILE_BRIDGE__) {
      return new MobileUIController();
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      return new WebUIController();
    }
    return new TerminalUIController();
  }

  async openPage(page: PageRoute, params?: Record<string, any>): Promise<void> {
    return this.controller.openPage(page, params);
  }

  async closePage(): Promise<void> {
    if (this.controller.closePage) return this.controller.closePage();
  }

  async updateState(state: UIState): Promise<void> {
    if (this.controller.updateState) return this.controller.updateState(state);
  }

  async showProgress(taskId: string, progress: number, message: string): Promise<void> {
    if (this.controller.showProgress) {
      return this.controller.showProgress(taskId, progress, message);
    }
  }

  getPlatform(): string {
    return this.controller.platform;
  }

  async isAvailable(): Promise<boolean> {
    return this.controller.isAvailable();
  }

  // 便捷方法
  async openPlay(mode: PlayMode, params?: any): Promise<void> {
    return this.openPage(`/play/${mode}` as PageRoute, params);
  }

  async openFetcher(url?: string): Promise<void> {
    return this.openPage('/fetcher', url ? { url } : undefined);
  }

  async openPlayer(name?: string): Promise<void> {
    return this.openPage('/player', name ? { name } : undefined);
  }

  async openJoseki(position?: string): Promise<void> {
    return this.openPage('/joseki', position ? { position } : undefined);
  }

  async openOpponent(playerId?: string): Promise<void> {
    return this.openPage('/opponent', playerId ? { playerId } : undefined);
  }

  async openRecorder(gameId?: string): Promise<void> {
    return this.openPage('/recorder', gameId ? { gameId } : undefined);
  }

  async openQuiz(quizId?: string): Promise<void> {
    return this.openPage('/quiz', quizId ? { quizId } : undefined);
  }

  async openEvent(contestId?: string): Promise<void> {
    return this.openPage('/event', contestId ? { contestId } : undefined);
  }

  async openGames(playerId?: string): Promise<void> {
    return this.openPage('/games', playerId ? { playerId } : undefined);
  }
}
