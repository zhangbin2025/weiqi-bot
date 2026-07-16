/**
 * DataChannel 管理器
 * @description 管理 RTCDataChannel 的数据收发和状态
 * @ai-example
 * const manager = new DataChannelManager();
 * manager.attach(channel);
 * manager.onData((data) => console.log('Received:', data));
 * manager.send('Hello');
 */

/**
 * DataChannel 事件回调
 */
export interface IDataChannelCallbacks {
  /** 收到数据 */
  onData?: (data: string | ArrayBuffer) => void;

  /** 打开 */
  onOpen?: () => void;

  /** 关闭 */
  onClose?: () => void;

  /** 发生错误 */
  onError?: (error: Error) => void;
}

/**
 * DataChannel 管理器
 */
export class DataChannelManager {
  private channel: RTCDataChannel | null = null;
  private callbacks: IDataChannelCallbacks = {};

  /**
   * 绑定 DataChannel
   */
  attach(channel: RTCDataChannel): void {
    this.channel = channel;
    this.setupEventHandlers();
  }

  /**
   * 发送数据
   */
  send(data: string | ArrayBuffer): void {
    if (!this.channel) {
      throw new Error('DataChannel not attached');
    }

    if (this.channel.readyState !== 'open') {
      throw new Error('DataChannel is not open');
    }

    this.channel.send(data as string);
  }

  /**
   * 关闭 DataChannel
   */
  close(): void {
    this.channel?.close();
    this.channel = null;
  }

  /**
   * 获取状态
   */
  get readyState(): RTCDataChannelState {
    return this.channel?.readyState ?? 'closed';
  }

  /**
   * 是否已打开
   */
  get isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  /**
   * 设置事件回调
   */
  setCallbacks(callbacks: IDataChannelCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.channel) return;

    // 收到数据
    this.channel.onmessage = (event) => {
      this.callbacks.onData?.(event.data);
    };

    // 打开
    this.channel.onopen = () => {
      this.callbacks.onOpen?.();
    };

    // 关闭
    this.channel.onclose = () => {
      this.callbacks.onClose?.();
    };

    // 错误
    this.channel.onerror = (error) => {
      this.callbacks.onError?.(new Error('DataChannel error'));
    };
  }
}
