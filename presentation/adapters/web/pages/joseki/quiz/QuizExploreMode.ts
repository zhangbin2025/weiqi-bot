/**
 * 定式挑战探索模式
 * @description 处理探索模式的逻辑
 */
import type { JosekiBoard } from '../../../components/JosekiBoard';
import type { QuizUIHelper } from './QuizUIHelper';
/** 目标着法 */
export interface TargetMove {
  x: number;
  y: number;
  color: 'black' | 'white';
  isPass: boolean;
}
/** 探索模式配置 */
export interface QuizExploreModeConfig {
  board: JosekiBoard;
  uiHelper: QuizUIHelper;
}
/** 探索模式状态 */
export interface ExploreState {
  currentIndex: number;
  userMoves: TargetMove[];
}
/** 探索模式返回结果 */
export interface ExploreResult {
  /** 是否需要自动跳过 */
  needAutoSkip: boolean;
  /** 新的索引 */
  newIndex: number;
  /** 新的用户着法列表 */
  newUserMoves: TargetMove[];
}
/** 探索模式控制器 */
export class QuizExploreMode {
  constructor(private config: QuizExploreModeConfig) {}
  /** 显示探索状态 */
  showExploreState(
    targetMoves: TargetMove[],
    state: ExploreState,
  ): ExploreResult | null {
    this.config.board.setMoves(state.userMoves);
    // 检查是否完成
    if (state.currentIndex >= targetMoves.length) {
      this.config.board.setBranches([]);
      (document.getElementById('challenge-btn') as HTMLButtonElement).disabled = false;
      return null;
    }
    const target = targetMoves[state.currentIndex];
    if (!target) return null;
    // 检查是否是脱先
    if (target.isPass) {
      // 返回需要自动跳过的信息
      this.config.uiHelper.showPassOverlay(`${target.color === 'black' ? '黑' : '白'}方脱先`);
      const newUserMoves = [...state.userMoves, target];
      return {
        needAutoSkip: true,
        newIndex: state.currentIndex + 1,
        newUserMoves,
      };
    }
    // 显示下一个目标选点
    const sgf = String.fromCharCode(97 + target.x, 97 + target.y);
    this.config.board.setBranches([{ x: target.x, y: target.y, color: target.color, sgf, heat: 100 }]);
    this.config.board.render();
    (document.getElementById('undo-btn') as HTMLButtonElement).disabled = state.currentIndex <= 0;
    (document.getElementById('challenge-btn') as HTMLButtonElement).disabled = state.currentIndex < targetMoves.length;
    return null;
  }
  /** 处理探索点击 */
  handleClick(
    pos: { x: number; y: number },
    targetMoves: TargetMove[],
    currentIndex: number,
  ): { correct: boolean; newIndex: number } {
    const target = targetMoves[currentIndex];
    if (!target) return { correct: false, newIndex: currentIndex };
    if (target.isPass) return { correct: false, newIndex: currentIndex }; // 脱先不响应点击
    if (pos.x === target.x && pos.y === target.y) {
      // 正确！
      return { correct: true, newIndex: currentIndex + 1 };
    }
    return { correct: false, newIndex: currentIndex };
  }
}
