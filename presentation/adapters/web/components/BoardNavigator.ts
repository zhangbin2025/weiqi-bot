/**
 * 棋盘导航器UI组件
 * @description 导航UI（滑块+按钮）
 * @module presentation/adapters/web/components/BoardNavigator
 */
/**
 * 棋盘导航器配置
 */
export interface BoardNavigatorConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** 最大手数 */
  maxMoves: number;
  /** 上一手回调 */
  onPrev: () => void;
  /** 下一手回调 */
  onNext: () => void;
  /** 滑块变化回调 */
  onSliderChange: (value: number) => void;
  /** 播放回调（可选） */
  onPlay?: () => void;
}
/**
 * 棋盘导航器UI组件
 */
export class BoardNavigator {
  private container: HTMLElement;
  private slider: HTMLInputElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private onPrev: () => void;
  private onNext: () => void;
  private onSliderChange: (value: number) => void;
  private onPlay: (() => void) | undefined;
  constructor(config: BoardNavigatorConfig) {
    this.container = config.container;
    this.onPrev = config.onPrev;
    this.onNext = config.onNext;
    this.onSliderChange = config.onSliderChange;
    this.onPlay = config.onPlay;
    this.render(config.maxMoves);
  }
  /**
   * 渲染导航器UI
   */
  private render(maxMoves: number): void {
    this.container.innerHTML = `
      <div class="controls-row">
        <div class="controls-group">
          <div class="slider-container">
            <input type="range" id="moveSlider" min="0" max="${maxMoves}" value="0">
          </div>
        </div>
        <div class="controls-divider"></div>
        <div class="controls-group main-controls">
          <button class="btn" id="prevBtn" title="上一手">◀</button>
          <button class="btn" id="nextBtn" title="下一手">▶</button>
          ${this.onPlay ? '<button class="btn" id="playBtn" title="播放/暂停">播</button>' : ''}
        </div>
      </div>
    `;
    this.bindEvents();
  }
  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 获取元素
    this.slider = this.container.querySelector('#moveSlider');
    this.prevBtn = this.container.querySelector('#prevBtn');
    this.nextBtn = this.container.querySelector('#nextBtn');
    this.playBtn = this.container.querySelector('#playBtn');
    // 滑块事件
    this.slider?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      this.onSliderChange(value);
    });
    // 按钮事件
    this.prevBtn?.addEventListener('click', () => this.onPrev());
    this.nextBtn?.addEventListener('click', () => this.onNext());
    this.playBtn?.addEventListener('click', () => this.onPlay?.());
  }
  /**
   * 更新滑块值
   */
  updateSlider(value: number): void {
    if (this.slider) {
      this.slider.value = String(value);
    }
  }
  /**
   * 设置最大手数
   */
  setMaxMoves(max: number): void {
    if (this.slider) {
      this.slider.max = String(max);
    }
  }
  /**
   * 更新播放按钮状态
   */
  updatePlayButton(isPlaying: boolean): void {
    if (this.playBtn) {
      this.playBtn.textContent = isPlaying ? '⏸' : '播';
    }
  }
  /**
   * 销毁组件
   */
  destroy(): void {
    this.container.innerHTML = '';
    this.slider = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.playBtn = null;
  }
}
