/**
 * 打印管理器（公共模块）
 * @description 环境检测 + 打印策略，供 replay 和 decision 打印共用
 * 支持：Desktop（Electron）、Android App、微信浏览器、普通 Web
 */

export class PrintManager {
  /**
   * 检测当前运行环境
   */
  static detectEnv(): 'desktop' | 'android-app' | 'wechat' | 'web' {
    const isDesktop = !!(window as any).electronAPI?.isDesktop;
    if (isDesktop) return 'desktop';

    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua) || /Linux arm/i.test(navigator.platform);
    const isWeiqiApp = /WeiqiApp/i.test(ua);
    if (isWeiqiApp && isAndroid) return 'android-app';

    if (/MicroMessenger/i.test(ua)) return 'wechat';

    return 'web';
  }

  /**
   * 执行打印
   * @param canvasSelector 缩略图 canvas 的 CSS 选择器
   * @param titleSelector 标题元素的 CSS 选择器（用于微信合成图）
   */
  static print(canvasSelector: string = '.thumbnail-card canvas', titleSelector: string = '.thumbnail-title'): void {
    const env = this.detectEnv();

    if (env === 'desktop' || env === 'web') {
      window.print();
      return;
    }

    if (env === 'android-app') {
      this.androidPrint(canvasSelector);
      return;
    }

    if (env === 'wechat') {
      this.wechatPrint(canvasSelector, titleSelector);
      return;
    }
  }

  /**
   * Android App 打印：调整 canvas 尺寸后调用原生 bridge
   */
  private static androidPrint(canvasSelector: string): void {
    try {
      const canvases = document.querySelectorAll(canvasSelector) as NodeListOf<HTMLCanvasElement>;
      const originalStyles: Array<{ width: string; height: string }> = [];
      canvases.forEach((canvas, i) => {
        originalStyles[i] = { width: canvas.style.width, height: canvas.style.height };
        canvas.style.width = '85mm';
        canvas.style.height = '85mm';
      });

      console.log('Calling native print bridge...');
      const result = prompt('print:invoke');
      console.log('Print bridge result:', result);

      setTimeout(() => {
        canvases.forEach((canvas, i) => {
          canvas.style.width = originalStyles[i].width;
          canvas.style.height = originalStyles[i].height;
        });
      }, 1000);
    } catch (error) {
      console.error('Print bridge failed:', error);
      alert('打印失败，请尝试截图分享');
    }
  }

  /**
   * 微信浏览器打印：合成大图弹窗，长按保存
   */
  private static wechatPrint(canvasSelector: string, titleSelector: string): void {
    try {
      const canvases = document.querySelectorAll(canvasSelector) as NodeListOf<HTMLCanvasElement>;
      if (canvases.length === 0) {
        alert('没有可打印的内容');
        return;
      }

      // 动态获取行列数（从 grid 样式读取）
      const grid = document.querySelector('.thumbnail-grid') as HTMLElement;
      const computedStyle = window.getComputedStyle(grid);
      const cols = computedStyle.gridTemplateColumns.split(' ').length;
      const rows = Math.ceil(canvases.length / cols);

      const cardWidth = 600;
      const cardHeight = 650;
      const gap = 20;

      const totalWidth = cols * cardWidth + (cols - 1) * gap;
      const totalHeight = rows * cardHeight + (rows - 1) * gap;

      const merged = document.createElement('canvas');
      merged.width = totalWidth;
      merged.height = totalHeight;
      const ctx = merged.getContext('2d');
      if (!ctx) {
        alert('生成图片失败');
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, totalWidth, totalHeight);

      canvases.forEach((canvas, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * (cardWidth + gap);
        const y = row * (cardHeight + gap);

        ctx.drawImage(canvas, x, y, cardWidth, cardWidth);

        const titleEl = canvas.parentElement?.querySelector(titleSelector);
        if (titleEl) {
          ctx.fillStyle = '#333333';
          ctx.font = 'bold 24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(titleEl.textContent || '', x + cardWidth / 2, y + cardWidth + 30);
        }
      });

      const dataUrl = merged.toDataURL('image/jpeg', 0.9);

      // 弹窗预览
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.9); z-index: 9999;
        display: flex; flex-direction: column; align-items: center;
        padding: 20px; overflow-y: auto;
      `;

      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.cssText = `width: 100%; max-width: 600px; height: auto; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); margin-bottom: 20px;`;

      const hint = document.createElement('div');
      hint.textContent = '长按图片保存或分享';
      hint.style.cssText = `color: white; margin-top: 20px; font-size: 16px; text-align: center;`;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '关闭';
      closeBtn.style.cssText = `position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.2); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 16px; cursor: pointer;`;
      closeBtn.onclick = () => document.body.removeChild(overlay);

      overlay.appendChild(closeBtn);
      overlay.appendChild(img);
      overlay.appendChild(hint);
      document.body.appendChild(overlay);
    } catch (error) {
      console.error('Generate image failed:', error);
      alert('生成图片失败，请稍后重试');
    }
  }
}
