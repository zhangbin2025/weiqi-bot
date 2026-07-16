/**
 * IPC 桥接路由器
 * 
 * 对等 Android PromptHandler + BridgeHandler 路由
 */

import { BrowserWindow } from 'electron';
import { TaskHandler } from './task-handler';
import { SnifferHandler } from './sniffer-handler';
import { KatagoHandler } from './katago-handler';
import { ConfigHandler } from './config-handler';
import { FileHandler } from './file-handler';
import { ClipboardHandler } from './clipboard-handler';
import { DebugHandler } from './debug-handler';
import { ConsoleHandler } from './console-handler';

interface BridgeHandler {
  prefix: string;
  handle(message: string): string | Promise<string>;
}

export class BridgeRouter {
  private handlers: Map<string, BridgeHandler> = new Map();
  private window: BrowserWindow;

  constructor(window: BrowserWindow) {
    this.window = window;
    // 注册桥接处理器（对等 Android registerBridgeHandlers）
    this.register(new TaskHandler());
    this.register(new SnifferHandler(window));
    this.register(new KatagoHandler(window));
    this.register(new ConfigHandler());
    this.register(new FileHandler(window));
    this.register(new ClipboardHandler());
    this.register(new DebugHandler());
    this.register(new ConsoleHandler());
  }

  private register(handler: BridgeHandler) {
    this.handlers.set(handler.prefix, handler);
    console.log(`[BridgeRouter] Registered handler: ${handler.prefix}`);
  }

  /**
   * 同步处理桥接消息
   * 对等 Android PromptHandler.onTextPrompt 路由逻辑
   */
  handle(message: string): string {
    // 导航命令
    if (message === 'nav:back') {
      if (this.window.webContents.canGoBack()) {
        this.window.webContents.goBack();
        return JSON.stringify({ success: true });
      }
      return JSON.stringify({ success: false, reason: 'Cannot go back' });
    }
    
    if (message === 'nav:forward') {
      if (this.window.webContents.canGoForward()) {
        this.window.webContents.goForward();
        return JSON.stringify({ success: true });
      }
      return JSON.stringify({ success: false, reason: 'Cannot go forward' });
    }

    if (message === 'nav:state') {
      return JSON.stringify({
        canGoBack: this.window.webContents.canGoBack(),
        canGoForward: this.window.webContents.canGoForward(),
      });
    }
    
    if (message === 'nav:close') {
      this.window.close();
      return JSON.stringify({ success: true });
    }
    
    // 找到匹配的处理器
    const matched = Array.from(this.handlers.keys()).find(prefix => message.startsWith(prefix));
    
    if (matched) {
      const handler = this.handlers.get(matched)!;
      try {
        const result = handler.handle(message);
        // 如果是 Promise，返回等待标记（需要用 bridge-async）
        if (result instanceof Promise) {
          return JSON.stringify({ error: 'Use bridge-async for async handlers' });
        }
        return result;
      } catch (error: any) {
        return JSON.stringify({ error: error.message });
      }
    }

    // 未匹配的消息
    return JSON.stringify({ error: `Unknown bridge prefix: ${message.substring(0, 20)}` });
  }

  /**
   * 异步处理桥接消息
   */
  async handleAsync(message: string): Promise<string> {
    const matched = Array.from(this.handlers.keys()).find(prefix => message.startsWith(prefix));
    
    if (matched) {
      const handler = this.handlers.get(matched)!;
      try {
        return await handler.handle(message);
      } catch (error: any) {
        return JSON.stringify({ error: error.message });
      }
    }

    return JSON.stringify({ error: `Unknown bridge prefix: ${message.substring(0, 20)}` });
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.handlers.clear();
  }
}
