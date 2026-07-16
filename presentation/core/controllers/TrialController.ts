/**
 * 试下模式控制器
 * @module presentation/core/controllers/TrialController
 */
export interface TrialMove {
  x: number;
  y: number;
  color: 'black' | 'white';
  capturedCount?: number;
  capturedPositions?: Array<{ x: number; y: number }>;
}
export interface TrialControllerConfig {
  onEnter?: () => void;
  onExit?: () => void;
  onMoveChange?: (moves: TrialMove[], index: number) => void;
}
/**
 * 试下模式控制器
 * 适用场景：复盘、定式探索
 */
export class TrialController {
  private trialMode = false;
  private trialMoves: TrialMove[] = [];
  private trialIndex = 0;
  private startPath: number[] = [];
  private startIndex = 0;
  private koPosition: { x: number; y: number } | null = null;
  private onEnter?: (() => void) | undefined;
  private onExit?: (() => void) | undefined;
  private onMoveChange?: ((moves: TrialMove[], index: number) => void) | undefined;
  constructor(config: TrialControllerConfig = {}) {
    this.onEnter = config.onEnter;
    this.onExit = config.onExit;
    this.onMoveChange = config.onMoveChange;
  }
  enterTrial(path: number[], index: number): void {
    this.startPath = [...path];
    this.startIndex = index;
    this.trialMode = true;
    this.trialMoves = [];
    this.trialIndex = 0;
    this.koPosition = null;
    this.onEnter?.();
  }
  addMove(move: TrialMove): void {
    this.trialMoves = this.trialMoves.slice(0, this.trialIndex);
    this.trialMoves.push(move);
    this.trialIndex++;
    this.onMoveChange?.(this.trialMoves, this.trialIndex);
  }
  undo(): void {
    if (this.trialIndex > 0) {
      this.trialIndex--;
      this.onMoveChange?.(this.trialMoves, this.trialIndex);
    }
  }
  redo(): void {
    if (this.trialIndex < this.trialMoves.length) {
      this.trialIndex++;
      this.onMoveChange?.(this.trialMoves, this.trialIndex);
    }
  }
  exitTrial(): { path: number[]; index: number } {
    const result = { path: [...this.startPath], index: this.startIndex };
    this.trialMode = false;
    this.trialMoves = [];
    this.trialIndex = 0;
    this.koPosition = null;
    this.onExit?.();
    return result;
  }
  isInTrial(): boolean { return this.trialMode; }
  getTrialMoves(): TrialMove[] { return [...this.trialMoves]; }
  getTrialIndex(): number { return this.trialIndex; }
  getVisibleMoves(): TrialMove[] { return this.trialMoves.slice(0, this.trialIndex); }
  setKoPosition(pos: { x: number; y: number } | null): void { this.koPosition = pos; }
  getKoPosition(): { x: number; y: number } | null { return this.koPosition; }
  isKoPosition(x: number, y: number): boolean {
    return this.koPosition !== null && this.koPosition.x === x && this.koPosition.y === y;
  }
  getStartPath(): number[] { return [...this.startPath]; }
  getStartIndex(): number { return this.startIndex; }
  reset(): void {
    this.trialMode = false;
    this.trialMoves = [];
    this.trialIndex = 0;
    this.startPath = [];
    this.startIndex = 0;
    this.koPosition = null;
  }
}
