/**
 * 定式挑战模式
 * @description 处理挑战模式的逻辑
 */
import type { JosekiBoard } from '../../../components/JosekiBoard';
import type { IAudioPlayer } from '../../../../../../infrastructure/audio/IAudioPlayer';
import type { QuizUIHelper } from './QuizUIHelper';
import type { TargetMove } from './QuizExploreMode';
/** 挑战模式配置 */
export interface QuizChallengeModeConfig {
  board: JosekiBoard;
  uiHelper: QuizUIHelper;
  audioPlayer?: IAudioPlayer | undefined;
  onChallengeComplete: (result: { success: boolean; path: string[] }) => void;
}
/** 挑战状态 */
export interface ChallengeState {
  userColor: 'black' | 'white' | null;
  currentIndex: number;
  userMoves: TargetMove[];
}
/**
 * 挑战模式控制器
 */
export class QuizChallengeMode {
  private state: ChallengeState = {
    userColor: null,
    currentIndex: 0,
    userMoves: [],
  };
  constructor(private config: QuizChallengeModeConfig) {}
  /** 重置状态 */
  reset(): void {
    this.state = {
      userColor: null,
      currentIndex: 0,
      userMoves: [],
    };
  }
  /** 开始挑战 */
  startChallenge(
    color: 'black' | 'white',
    targetMoves: TargetMove[],
    onProgress: () => void,
  ): void {
    this.state = {
      userColor: color,
      currentIndex: 0,
      userMoves: [],
    };
    this.config.uiHelper.hideModal('color-modal');
    this.config.uiHelper.updateModeBadge('challenge');
    // 显示脱先按钮
    (document.getElementById('pass-btn') as HTMLElement).style.display = 'block';
    this.showChallengeState(targetMoves, onProgress);
  }
  /** 显示挑战状态 */
  showChallengeState(
    targetMoves: TargetMove[],
    onProgress: () => void,
  ): void {
    this.config.board.setMoves(this.state.userMoves);
    // 检查是否完成
    if (this.state.currentIndex >= targetMoves.length) {
      this.challengeSuccess();
      return;
    }
    const target = targetMoves[this.state.currentIndex];
    if (!target) return;
    const isUserTurn = target.color === this.state.userColor;
    if (!isUserTurn) {
      // AI回合，禁止所有点击（设置一个不可能的位置）
      this.config.board.setBranches([{ x: -99, y: -99, color: target.color, sgf: '', heat: 0 }]);
      this.config.board.render();
      // AI回合，自动落子
      setTimeout(() => {
        if (target.isPass) {
          this.config.uiHelper.showPassOverlay(`${target.color === 'black' ? '黑' : '白'}方脱先`);
          setTimeout(() => {
            this.state.userMoves.push(target); // 记录 AI 脱先着法
            this.state.currentIndex++;
            onProgress();
            this.showChallengeState(targetMoves, onProgress);
          }, 600);
        } else {
          this.state.userMoves.push(target);
          this.state.currentIndex++;
          this.config.board.setMoves(this.state.userMoves);
          onProgress();
          setTimeout(() => this.showChallengeState(targetMoves, onProgress), 500);
        }
      }, 500);
      // AI 回合时直接返回，不要继续执行下面的按钮状态设置
      return;
    }
    // 用户回合，不显示选点提示，允许点击任意空位（handleClick 会验证正确性）
    this.config.board.setBranches([]);
    this.config.board.render();
    (document.getElementById('undo-btn') as HTMLButtonElement).disabled = true;
    (document.getElementById('challenge-btn') as HTMLButtonElement).disabled = true;
  }
  /** 处理挑战点击 */
  handleClick(
    pos: { x: number; y: number },
    targetMoves: TargetMove[],
    onProgress: () => void,
  ): { correct: boolean; newIndex: number } {
    const target = targetMoves[this.state.currentIndex];
    if (!target) return { correct: false, newIndex: this.state.currentIndex };
    // 检查是否轮到用户
    if (target.color !== this.state.userColor) {
      return { correct: false, newIndex: this.state.currentIndex };
    }
    if (target.isPass) {
      this.showChallengeFail('正确答案是脱先！', targetMoves);
      return { correct: false, newIndex: this.state.currentIndex };
    }
    if (pos.x === target.x && pos.y === target.y) {
      // 正确！立即禁止再次点击（防止快速连点）
      this.config.board.setBranches([{ x: -99, y: -99, color: target.color, sgf: '', heat: 0 }]);
      this.config.board.render();
      this.state.userMoves.push(target);
      this.state.currentIndex++;
      onProgress();
      return { correct: true, newIndex: this.state.currentIndex };
    } else {
      this.showChallengeFail('位置错误！', targetMoves);
      return { correct: false, newIndex: this.state.currentIndex };
    }
  }
  /** 处理脱先 */
  handlePass(
    targetMoves: TargetMove[],
    onProgress: () => void,
  ): boolean {
    const target = targetMoves[this.state.currentIndex];
    if (!target || target.color !== this.state.userColor) return false;
    if (target.isPass) {
      // 正确脱先：立即禁止再次点击
      this.config.board.setBranches([{ x: -99, y: -99, color: target.color, sgf: '', heat: 0 }]);
      this.config.board.render();
      this.config.uiHelper.showPassOverlay('脱先');
      this.state.userMoves.push(target); // 记录用户脱先着法
      this.state.currentIndex++;
      onProgress();
      return true;
    } else {
      this.showChallengeFail('正确答案不是脱先！', targetMoves);
      return false;
    }
  }
  /** 显示失败 */
  showChallengeFail(message: string, targetMoves: TargetMove[]): void {
    // 显示正确位置
    const target = targetMoves[this.state.currentIndex];
    if (target && !target.isPass) {
      const sgf = String.fromCharCode(97 + target.x, 97 + target.y);
      this.config.board.setBranches([{ x: target.x, y: target.y, color: target.color, sgf, heat: 100 }]);
      this.config.board.render();
    }
    (document.getElementById('fail-message') as HTMLElement).textContent = message;
    document.getElementById('fail-modal')?.classList.add('show');
  }
  /** 挑战成功 */
  challengeSuccess(): void {
    // 调用完成回调，记录挑战结果
    const path = this.state.userMoves.map(m => {
      if (m.isPass) return 'tt';
      return String.fromCharCode(97 + m.x, 97 + m.y);
    });
    this.config.onChallengeComplete({ success: true, path });
    // 显示成功弹窗
    document.getElementById('success-modal')?.classList.add('show');
  }
  /** 返回探索 */
  backToExplore(targetMoves: TargetMove[], onProgress: () => void): void {
    this.config.uiHelper.hideModal('fail-modal');
    this.reset();
    this.config.uiHelper.updateModeBadge('explore');
    (document.getElementById('pass-btn') as HTMLElement).style.display = 'none';
  }
  /** 重试挑战 */
  retryChallenge(targetMoves: TargetMove[], onProgress: () => void): void {
    this.config.uiHelper.hideModal('fail-modal');
    if (this.state.userColor) {
      this.startChallenge(this.state.userColor, targetMoves, onProgress);
    }
  }
  /** 显示颜色选择弹窗 */
  showColorModal(): void {
    document.getElementById('color-modal')?.classList.add('show');
  }
  /** 隐藏颜色选择弹窗 */
  hideColorModal(): void {
    document.getElementById('color-modal')?.classList.remove('show');
  }
  /** 获取当前状态 */
  getState(): ChallengeState {
    return this.state;
  }
}
