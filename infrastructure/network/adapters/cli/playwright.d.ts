declare module 'playwright' {
  export class Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }
  export class Page {
    goto(url: string): Promise<Response>;
    content(): Promise<string>;
    close(): Promise<void>;
    waitForSelector(selector: string, options?: unknown): Promise<ElementHandle>;
  }
  export class ElementHandle {
    textContent(): Promise<string | null>;
  }
  export class Response {
    status(): number;
    text(): Promise<string>;
  }
  export const firefox: { launch(options?: unknown): Promise<Browser> };
export const webkit: { launch(options?: unknown): Promise<Browser> };
export const chromium: { launch(options?: unknown): Promise<Browser> };
}
