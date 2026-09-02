/**
 * 二维码扫描器
 * @module presentation/adapters/web/pages/assistant/QRScanner
 *
 * 使用 getUserMedia + jsQR 实现摄像头实时扫描。
 * 扫描到 URL 后通过回调返回，由调用方填入消息框发送。
 */

import jsQR from 'jsqr';

export interface QRScannerCallbacks {
  /** 扫描成功，返回解码出的文本 */
  onResult: (text: string) => void;
  /** 扫描出错（无摄像头权限、不支持等） */
  onError?: (message: string) => void;
}

export class QRScanner {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private rafId: number = 0;
  private scanning = false;
  private overlay: HTMLDivElement | null = null;
  private callbacks: QRScannerCallbacks;
  /** 扫描成功后等待 ms 再关闭，避免闪烁 */
  private closeDelay = 300;

  constructor(callbacks: QRScannerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * 启动扫码界面
   */
  async start(): Promise<void> {
    if (this.scanning) return;

    // 检查 API 支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.callbacks.onError?.('当前浏览器不支持摄像头调用');
      return;
    }

    // 创建全屏覆盖层
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: #000; z-index: 10000;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
    `;

    // 顶部标题栏
    const header = document.createElement('div');
    header.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0;
      padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(0,0,0,0.6); color: #fff; font-size: 17px;
      z-index: 2;
    `;
    header.innerHTML = '<span>扫一扫</span>';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background: none; border: none; color: #fff;
      font-size: 22px; cursor: pointer; padding: 4px 8px;
    `;
    closeBtn.onclick = () => this.stop();
    header.appendChild(closeBtn);

    this.overlay.appendChild(header);

    // 视频元素
    this.video = document.createElement('video');
    this.video.style.cssText = `
      width: 100%; height: 100%; object-fit: cover;
    `;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('muted', '');
    this.overlay.appendChild(this.video);

    // 扫描框提示
    const frame = document.createElement('div');
    frame.style.cssText = `
      position: absolute; width: 70%; max-width: 280px;
      aspect-ratio: 1; border: 2px solid rgba(102,126,234,0.8);
      border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
      pointer-events: none;
    `;
    this.overlay.appendChild(frame);

    // 底部提示文字
    const tip = document.createElement('div');
    tip.style.cssText = `
      position: absolute; bottom: calc(80px + env(safe-area-inset-bottom));
      left: 0; right: 0; text-align: center;
      color: rgba(255,255,255,0.8); font-size: 14px;
    `;
    tip.textContent = '将二维码放入框中即可自动扫描';
    this.overlay.appendChild(tip);

    // 从相册选图按钮
    const albumBtn = document.createElement('button');
    albumBtn.textContent = '相册';
    albumBtn.style.cssText = `
      position: absolute; bottom: calc(20px + env(safe-area-inset-bottom));
      right: 20px; background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.4);
      color: #fff; padding: 8px 20px; border-radius: 20px;
      font-size: 14px; cursor: pointer;
    `;
    albumBtn.onclick = () => this.pickFromAlbum();
    this.overlay.appendChild(albumBtn);

    // 隐藏的 file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) {
        await this.decodeImageFile(file);
      }
      input.value = '';
    });
    this.overlay.appendChild(fileInput);
    // 给 albumBtn 引用
    (this.overlay as any)._fileInput = fileInput;

    document.body.appendChild(this.overlay);

    // canvas 用于逐帧解码
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    // 请求摄像头
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.scanning = true;
      this.scanLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '无法访问摄像头';
      this.callbacks.onError?.(msg);
      this.cleanup();
    }
  }

  /**
   * 逐帧扫描循环
   */
  private scanLoop(): void {
    if (!this.scanning || !this.video || !this.canvas || !this.ctx) return;

    const video = this.video;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      // 限制 canvas 尺寸以提升性能
      const scale = Math.min(1, 480 / Math.max(w, h));
      const cw = Math.floor(w * scale);
      const ch = Math.floor(h * scale);
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.ctx.drawImage(video, 0, 0, cw, ch);

      const imageData = this.ctx.getImageData(0, 0, cw, ch);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        this.handleResult(code.data);
        return;
      }
    }

    this.rafId = requestAnimationFrame(() => this.scanLoop());
  }

  /**
   * 处理扫描结果
   */
  private handleResult(text: string): void {
    // 震动反馈
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }

    // 延迟关闭，让用户看到成功反馈
    setTimeout(() => {
      this.stop();
      this.callbacks.onResult(text);
    }, this.closeDelay);
  }

  /**
   * 从相册选择图片解码
   */
  private pickFromAlbum(): void {
    const fi = (this.overlay as any)._fileInput as HTMLInputElement;
    fi?.click();
  }

  /**
   * 解码图片文件
   */
  private async decodeImageFile(file: File): Promise<void> {
    try {
      const img = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (code && code.data) {
        this.handleResult(code.data);
      } else {
        this.callbacks.onError?.('未能在图片中识别到二维码');
      }
    } catch {
      this.callbacks.onError?.('图片解码失败');
    }
  }

  /**
   * 停止扫描并关闭界面
   */
  stop(): void {
    this.scanning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.cleanup();
  }

  /**
   * 清理 DOM
   */
  private cleanup(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
  }
}
