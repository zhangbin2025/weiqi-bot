/**
 * 手数导航控制器
 * @module presentation/core/controllers/MoveNavigator
 */
export interface MoveNavigatorConfig {
  maxMoves: number;
  onMoveChange: (index: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}
/**
 * 手数导航控制器
 * 适用场景：复盘、打谱、定式探索、做题
 */
export class MoveNavigator {
  private currentIndex = 0;
  private maxMoves: number;
  private isPlaying = false;
  private playInterval?: ReturnType<typeof setInterval> | undefined;
  private onMoveChange: (index: number) => void;
  private onPlayStateChange?: ((isPlaying: boolean) => void) | undefined;
  private playSpeed = 800;
  constructor(config: MoveNavigatorConfig) {
    this.maxMoves = config.maxMoves;
    this.onMoveChange = config.onMoveChange;
    this.onPlayStateChange = config.onPlayStateChange;
  }
  prev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.onMoveChange(this.currentIndex);
    }
  }
  next(): void {
    if (this.currentIndex < this.maxMoves) {
      this.currentIndex++;
      this.onMoveChange(this.currentIndex);
    }
  }
  goTo(index: number): void {
    const target = Math.max(0, Math.min(index, this.maxMoves));
    if (target !== this.currentIndex) {
      this.currentIndex = target;
      this.onMoveChange(this.currentIndex);
    }
  }
  togglePlay(speed?: number): void {
    if (this.maxMoves === 0) {
      return;
    }
    if (this.isPlaying) {
      this.stopPlay();
    } else {
      this.startPlay(speed);
    }
  }
  private startPlay(speed?: number): void {
    if (this.isPlaying) return;
    if (this.maxMoves === 0) {
      return;
    }
    const actualSpeed = speed || this.playSpeed;
    this.isPlaying = true;
    this.onPlayStateChange?.(true);
    this.playInterval = setInterval(() => {
      if (this.currentIndex < this.maxMoves) {
        this.currentIndex++;
        this.onMoveChange(this.currentIndex);
      } else {
        this.stopPlay();
      }
    }, actualSpeed);
  }
  private stopPlay(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.onPlayStateChange?.(false);
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = undefined;
    }
  }
  getCurrentIndex(): number { return this.currentIndex; }
  getIsPlaying(): boolean { return this.isPlaying; }
  setMaxMoves(max: number): void {
    this.maxMoves = max;
    if (this.currentIndex > this.maxMoves) {
      this.currentIndex = this.maxMoves;
      this.onMoveChange(this.currentIndex);
    }
  }
  getMaxMoves(): number { return this.maxMoves; }
  destroy(): void { this.stopPlay(); }
}
