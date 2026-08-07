/**
 * @fileoverview 回调处理器 - 处理游戏回调
 * @description 封装游戏结束、数子请求等回调逻辑
 */
import type { HHPlayApp } from '../../../../../../application/play';
import type { PlayerColor } from '../../../../../core/types';
/** 回调处理器配置 */
export interface HHCallbacksHandlerConfig {
  hhPlayApp: HHPlayApp;
}
/** 游戏结束回调 */
export type GameEndCallback = (winner: PlayerColor | 'draw', reason: string, scoreLead?: number) => void;
/**
 * 回调处理器
 * @description 负责处理游戏的回调事件
 */
export class HHCallbacksHandler {
  private hhPlayApp: HHPlayApp;
  constructor(config: HHCallbacksHandlerConfig) {
    this.hhPlayApp = config.hhPlayApp;
  }
  /**
   * 处理游戏结束
   * @param winner 赢家
   * @param reason 结束原因
   * @param scoreLead 领先目数（数子时）
   * @param onRedirect 跳转回调
   */
  async handleGameEnd(
    winner: PlayerColor | 'draw',
    reason: string,
    scoreLead: number | undefined,
    onRedirect: () => void
  ): Promise<void> {
    const winnerText = winner === 'black'
      ? '黑方胜'
      : winner === 'white'
      ? '白方胜'
      : '和棋';
    const reasonText = reason === 'resign'
      ? '认输'
      : reason === 'timeout'
      ? '超时'
      : reason === 'double_pass'
      ? '双停'
      : '数子';
    // 构建详细信息
    let detailText = '';
    if (reason === 'count' && scoreLead !== undefined) {
      const absScore = Math.abs(scoreLead);
      if (winner === 'black') {
        detailText = `黑方胜 ${absScore.toFixed(1)} 目`;
      } else if (winner === 'white') {
        detailText = `白方胜 ${absScore.toFixed(1)} 目`;
      } else {
        detailText = '和棋';
      }
    }
    // 显示结果弹框
    const container = document.getElementById('dialogContainer');
    if (container) {
      container.innerHTML = `
        <div class="dialog-overlay show">
          <div class="dialog">
            <div class="dialog-title">对局结束</div>
            <div style="text-align:center;margin-bottom:16px;font-size:18px;font-weight:500">
              ${winnerText}（${reasonText}）
            </div>
            ${detailText ? `<div style="text-align:center;margin-bottom:16px;font-size:16px;color:#666">${detailText}</div>` : ''}
            <button class="btn btn-primary" id="confirmEndBtn">确定</button>
          </div>
        </div>
      `;
      document.getElementById('confirmEndBtn')?.addEventListener('click', async () => {
        // 保存对局记录
        try {
          const historyData: {
            winner: 'black' | 'white' | 'draw';
            reason: 'resign' | 'timeout' | 'double_pass' | 'count';
            scoreLead?: number;
          } = {
            winner: winner as 'black' | 'white' | 'draw',
            reason: reason as 'resign' | 'timeout' | 'double_pass' | 'count',
          };
          if (scoreLead !== undefined) {
            historyData.scoreLead = scoreLead;
          }
          await this.hhPlayApp.saveToHistory(historyData);
        } catch (err) {
          console.warn('保存对局记录失败', err);
        }
        onRedirect();
      });
    }
  }
}
