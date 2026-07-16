/**
 * 终端 TUI 控制器
 * 使用 blessed 或其他 TUI 库
 */
import type { IUIController, PageRoute, UIState } from '../types';

export interface TerminalScreen {
  render(): void;
  destroy(): void;
  setContent(content: string): void;
}

export class TerminalUIController implements IUIController {
  readonly platform = 'terminal' as const;
  private currentScreen: TerminalScreen | null = null;
  private screens: Map<string, TerminalScreen> = new Map();

  async isAvailable(): Promise<boolean> {
    // 终端环境总是可用作为后备
    return true;
  }

  async openPage(page: PageRoute, params?: Record<string, any>): Promise<void> {
    const screenName = this.pageToScreenName(page);

    // 切换到对应屏幕
    if (this.screens.has(screenName)) {
      this.currentScreen = this.screens.get(screenName)!;
    } else {
      this.currentScreen = this.createDefaultScreen(screenName, params);
      this.screens.set(screenName, this.currentScreen);
    }

    this.currentScreen.render();
    console.log(`[Terminal] Opened page: ${page}`, params || '');
  }

  async closePage(): Promise<void> {
    if (this.currentScreen) {
      this.currentScreen.destroy();
      this.currentScreen = null;
    }
  }

  async updateState(state: UIState): Promise<void> {
    if (this.currentScreen && state.message) {
      this.currentScreen.setContent(state.message);
      this.currentScreen.render();
    }
  }

  async showProgress(_taskId: string, progress: number, message: string): Promise<void> {
    const progressBar = this.renderProgressBar(progress);
    console.log(`[Progress] ${progressBar} ${progress}% - ${message}`);
  }

  registerScreen(name: string, screen: TerminalScreen): void {
    this.screens.set(name, screen);
  }

  private pageToScreenName(page: PageRoute): string {
    return page.replace(/\//g, '_').replace(/^_/, '') || 'main';
  }

  private createDefaultScreen(name: string, _params?: Record<string, any>): TerminalScreen {
    // 简单的默认屏幕实现
    return {
      render: () => console.log(`[Screen: ${name}] Rendered`),
      destroy: () => console.log(`[Screen: ${name}] Destroyed`),
      setContent: (content: string) => console.log(`[Screen: ${name}] ${content}`)
    };
  }

  private renderProgressBar(progress: number): string {
    const width = 20;
    const filled = Math.floor(progress / 100 * width);
    const empty = width - filled;
    return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
  }
}
