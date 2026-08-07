declare module 'electron' {
  export class Notification {
    constructor(options: { title: string; body?: string; actions?: unknown[] });
    show(): void;
    close(): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }
  export class BrowserWindow {
    loadURL(url: string): void;
    webContents: { send(channel: string, ...args: unknown[]): void };
  }
}
