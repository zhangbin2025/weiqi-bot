/**
 * 人机对弈页面回调处理器
 * @module presentation/pages/play/HMPlayPageCallbacks
 */
import type { IBoard, IToast } from '../../../../core/interfaces';
import type { PlayerColor, Position } from '../../../../core/types';
import type { IHMPlayCallbacks } from '../../../../../services/play/hm';
import type { WebAudioPlayer } from '../../../../../infrastructure/audio/WebAudioPlayer';
export interface HMCallbackContext {
  board: IBoard;
  toast: IToast;
  audioPlayer: WebAudioPlayer;
  playerColor: PlayerColor;
  moveCount: number;
  updateStatus: (msg: string) => void;
  updateMoveCount: (count: number) => void;
  updateCaptures: (blackCaptures: number, whiteCaptures: number) => void;
  getCaptures: () => { blackCaptures: number; whiteCaptures: number };
  updateButtons: () => void;
  handleGameEnd: (winner: PlayerColor, reason: string) => void;
  render: () => void;
}
/**
 * 创建人机对弈回调处理器
 */
export function createHMPlayCallbacks(ctx: HMCallbackContext): IHMPlayCallbacks {
  return {
    onBoardChange: (_board) => {
      // 棋盘状态变化，重新渲染
      ctx.render();
    },
    onPlayerChange: (player) => {
      // 当前玩家变化
      if (player === ctx.playerColor) {
        // 轮到玩家
        ctx.updateStatus('轮到你落子');
      } else {
        // 轮到 AI
        ctx.updateStatus('AI思考中...');
      }
      ctx.updateButtons();
    },
    onAiThinking: (thinking) => {
      if (thinking) {
        ctx.updateStatus('AI思考中...');
      }
      ctx.updateButtons();
    },
    onAiMove: (x, y) => {
      // AI 落子
      ctx.moveCount++;
      ctx.updateMoveCount(ctx.moveCount);
      ctx.updateStatus('轮到你落子');
      // 播放 AI 落子音效
      ctx.audioPlayer.play('stone').catch(() => {
        console.warn('AI 落子音效播放失败');
      });
      // render 会在 onBoardChange 中被调用
    },
    onCapture: (count, color) => {
      // 提子
      const colorText = color === 'black' ? '黑方' : '白方';
      ctx.toast.info(`${colorText}提子 ${count} 枚`);
      // 更新提子数量显示
      const captures = ctx.getCaptures();
      ctx.updateCaptures(captures.blackCaptures, captures.whiteCaptures);
      // 播放提子音效
      ctx.audioPlayer.play('capture').catch(() => {
        console.warn('提子音效播放失败');
      });
    },
    onScoreChange: (score) => {
      // 目数变化（可选显示）
    },
    onGameEnd: (winner, reason) => {
      ctx.handleGameEnd(winner, reason);
    },
    onError: (error) => {
      ctx.toast.error(error.message);
    },
  };
}
