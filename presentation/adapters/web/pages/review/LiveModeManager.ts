/**
 * 直播模式管理器
 * @module presentation/adapters/web/pages/review/LiveModeManager
 *
 * 职责：
 * 1. 直播棋谱的加载和刷新
 * 2. 检测棋谱变化（着法序列对比，处理悔棋和棋谱重置）
 * 3. 增量分析和数据更新
 */

import type { IGameService } from '../../../../../services/game/IGameService';
import type { IFavoriteService } from '../../../../../services/favorite/IFavoriteService';
import type { ReviewApp } from '../../../../../application/review';
import { ReviewAnalysis, type AnalysisCompleteResult } from './ReviewAnalysis';
import type { PlayerColor } from '../../../../../domain/primitives';
import { sgfColorToPlayerColor } from '../../../../../domain/primitives';
import { SGFParser } from '../../../../../domain/sgf/SGFParser';
import { saveLiveArchiveId, loadLiveArchiveId } from './LiveCache';

/** 直播模式回调接口 */
export interface LiveModeCallbacks {
  /** 更新状态栏 */
  updateStatus: (msg: string) => void;
  /** 更新显示（当前手数、总手数） */
  updateDisplay: (current: number, total: number) => void;
  /** 跳转到指定手数 */
  goToMove: (moveNumber: number) => void;
  /** 更新胜率图 */
  updateWinrateChart: (trend: Array<{ moveNumber: number; winRate: number; scoreLead: number }>, current: number) => void;
  /** 获取当前手数 */
  getCurrentMove: () => number;
  /** 获取总手数 */
  getTotalMoves: () => number;
  /** 获取胜率趋势 */
  getWinrateTrend: () => Array<{ moveNumber: number; winRate: number; scoreLead: number }>;
  /** 设置胜率趋势 */
  setWinrateTrend: (trend: Array<{ moveNumber: number; winRate: number; scoreLead: number }>) => void;
  /** 获取着法列表 */
  getMoves: () => Array<{ x: number; y: number; color: PlayerColor }>;
  /** 设置着法列表 */
  setMoves: (moves: Array<{ x: number; y: number; color: PlayerColor }>) => void;
  /** 设置总手数 */
  setTotalMoves: (total: number) => void;
  /** 分析完成回调 */
  onAnalysisComplete: (result: AnalysisCompleteResult) => void;
}

/** 棋谱变化类型 */
type SgfChangeType = 'unchanged' | 'incremental' | 'changed';

/**
 * 直播模式管理器
 */
export class LiveModeManager {
  /** 是否处于直播模式 */
  private isLiveMode = false;
  /** 直播 URL */
  private liveUrl?: string;
  /** 刷新定时器 */
  private liveInterval: number | undefined = undefined;
  /** 上一次归档 ID */
  private previousArchiveId?: string;
  /** 上一次着法列表（用于对比） */
  private lastMoves: Array<{ x: number; y: number; color: PlayerColor }> = [];
  /** 连续刷新失败次数 */
  private liveFetchFailCount = 0;
  /** 连续失败阈值 */
  private static readonly LIVE_FETCH_FAIL_THRESHOLD = 5;
  /** 刷新间隔（毫秒） */
  private static readonly LIVE_REFRESH_INTERVAL = 30000;

  /** SGF 解析器 */
  private sgfParser: SGFParser;

  constructor(
    private gameService: IGameService,
    private favoriteService: IFavoriteService,
    private reviewApp: ReviewApp,
    private analysis: ReviewAnalysis,
    private callbacks: LiveModeCallbacks,
  ) {
    this.sgfParser = new SGFParser();
  }

  /**
   * 从直播 URL 加载棋谱
   */
  async loadFromUrl(liveUrl: string): Promise<void> {
    this.isLiveMode = true;
    this.liveUrl = liveUrl;
    console.info('[LiveModeManager] 进入直播模式', { url: liveUrl });

    // 尝试从缓存恢复
    const cachedArchiveId = loadLiveArchiveId(liveUrl);
    if (cachedArchiveId) {
      console.info('[LiveModeManager] 从缓存恢复:', cachedArchiveId);
      this.previousArchiveId = cachedArchiveId;
      await this.viewFavorite(cachedArchiveId);
      return;
    }

    // 无缓存：正常加载
    try {
      this.callbacks.updateStatus('正在下载直播棋谱...');
      console.info('[LiveModeManager] 从直播URL抓取棋谱...');
      const result = await this.gameService.fetch(liveUrl, true, 5000);

      if (!result.success || !result.archiveId) {
        console.error('[LiveModeManager] 直播棋谱抓取失败:', result.error);
        this.callbacks.updateStatus('直播棋谱下载失败');
        return;
      }

      this.previousArchiveId = result.archiveId;
      console.info('[LiveModeManager] 直播棋谱抓取成功:', result.archiveId);

      // 加载并分析棋谱
      const sgf = await this.gameService.getByArchiveId(result.archiveId);
      if (!sgf) {
        console.error('[LiveModeManager] 获取SGF失败');
        this.callbacks.updateStatus('直播棋谱加载失败');
        return;
      }

      // 解析着法并保存
      const moves = this.parseAllMoves(sgf);
      this.lastMoves = moves;
      
      // 分析棋谱
      await this.analysis.loadAndAnalyze(sgf, []);

      // 分析成功才保存缓存
      const currentArchiveId = this.analysis.getCurrentArchiveId();
      if (currentArchiveId) {
        saveLiveArchiveId(liveUrl, currentArchiveId);
        this.previousArchiveId = currentArchiveId;
      }
    } catch (error) {
      console.error('[LiveModeManager] 直播棋谱加载异常', error);
      this.callbacks.updateStatus('直播棋谱加载异常');
    }
  }

  /**
   * 从归档 ID 查看复盘（用于缓存恢复）
   */
  private async viewFavorite(archiveId: string): Promise<void> {
    await this.analysis.viewFavorite(archiveId);
  }

  /**
   * 启动直播刷新
   */
  start(): void {
    if (!this.isLiveMode || !this.liveUrl) return;

    console.info('[LiveModeManager] 启动直播刷新（30秒间隔）');
    this.refresh();
  }

  /**
   * 停止直播模式
   */
  stop(): void {
    if (this.liveInterval) {
      clearTimeout(this.liveInterval);
      this.liveInterval = undefined;
    }
    this.isLiveMode = false;
    this.liveFetchFailCount = 0;
    console.info('[LiveModeManager] 停止直播模式');
  }

  /**
   * 是否处于直播模式
   */
  isActive(): boolean {
    return this.isLiveMode;
  }

  /**
   * 刷新直播棋谱
   */
  private async refresh(): Promise<void> {
    if (!this.liveUrl) return;

    try {
      this.callbacks.updateStatus('直播中');

      // 1. 删除旧归档和旧复盘条目（强制重新抓取）
      if (this.previousArchiveId) {
        try {
          await this.favoriteService.removeFavorite(this.previousArchiveId);
          console.info('[LiveModeManager] 已删除旧复盘条目:', this.previousArchiveId);
          await (this.gameService as any).deleteArchive?.(this.previousArchiveId);
          console.info('[LiveModeManager] 已删除旧归档:', this.previousArchiveId);
        } catch (e) {
          // 忽略删除失败
        }
      }

      // 2. 重新抓取棋谱
      console.info('[LiveModeManager] 开始刷新直播棋谱');
      const result = await this.gameService.fetch(this.liveUrl, true, 5000);

      if (!result.success || !result.archiveId) {
        console.warn('[LiveModeManager] 刷新失败:', result.error);
        this.liveFetchFailCount++;
        if (this.liveFetchFailCount >= LiveModeManager.LIVE_FETCH_FAIL_THRESHOLD) {
          console.info('[LiveModeManager] 连续刷新失败', this.liveFetchFailCount, '次，停止直播');
          this.stop();
          this.callbacks.updateStatus('直播连接失败，已停止刷新');
        }
        return;
      }

      // fetch 成功，重置失败计数
      this.liveFetchFailCount = 0;

      // 3. 检测棋局结束（方式1：从 metadata.result 检测）
      if (result.metadata?.result && result.metadata.result !== '') {
        console.info('[LiveModeManager] 棋局已结束（检测到结果:', result.metadata.result, '），停止直播');
        this.stop();
        this.callbacks.updateStatus('棋局已结束: ' + result.metadata.result);
        return;
      }

      // 4. 获取新 SGF
      const newSgf = await this.gameService.getByArchiveId(result.archiveId);
      if (!newSgf) {
        console.warn('[LiveModeManager] 获取新SGF失败');
        return;
      }

      // 5. 检测棋局结束（方式2：从 SGF 的 RE[] 属性检测）
      const sgfResultMatch = newSgf.match(/RE\[([^\]]*)\]/);
      if (sgfResultMatch && sgfResultMatch[1] && sgfResultMatch[1] !== '') {
        console.info('[LiveModeManager] 棋局已结束（SGF结果:', sgfResultMatch[1], '），停止直播');
        this.stop();
        this.callbacks.updateStatus('棋局已结束: ' + sgfResultMatch[1]);
        return;
      }

      // 6. 解析新着法列表
      const newMoves = this.parseAllMoves(newSgf);
      const newMovesCount = newMoves.length;

      console.info('[LiveModeManager] 调试:', {
        newMovesCount,
        lastMovesCount: this.lastMoves.length,
        archiveId: result.archiveId,
        previousArchiveId: this.previousArchiveId,
        sgfLength: newSgf.length
      });

      // 7. 检测棋局结束（方式3：末尾双 Pass）
      if (newMovesCount >= 2 && this.isDoublePassAtEnd(newMoves)) {
        const resultStr = this.formatGameResult(newMoves);
        console.info('[LiveModeManager] 棋局已结束（末尾双Pass），停止直播');
        this.stop();
        this.callbacks.updateStatus('棋局已结束' + (resultStr ? ': ' + resultStr : ''));
        // 仍需处理新增着法（最后的 Pass 也需要追加）
      }

      // ========== 核心改动：着法序列对比 ==========
      
      const changeType = this.detectSgfChange(this.lastMoves, newMoves);
      
      console.info('[LiveModeManager] 棋谱变化检测:', changeType, {
        oldMoves: this.lastMoves.length,
        newMoves: newMovesCount,
      });

      if (changeType === 'unchanged') {
        // 无变化，跳过
        console.info('[LiveModeManager] 棋谱未变化，跳过更新');
      } else if (changeType === 'incremental') {
        // 增量更新
        const fromMove = this.lastMoves.length;
        await this.processNewMoves(newMoves, fromMove, newMovesCount);
        this.lastMoves = newMoves;
      } else {
        // 棋谱变化（悔棋或重置）
        console.info('[LiveModeManager] 棋谱已变化（悔棋或重置），重新加载');
        await this.resetAndReload(newSgf, result.archiveId);
        this.lastMoves = newMoves;
      }

      // 更新归档 ID
      this.previousArchiveId = result.archiveId;
      this.analysis.setCurrentArchiveId(result.archiveId);

      // 更新缓存
      if (this.liveUrl) {
        saveLiveArchiveId(this.liveUrl, result.archiveId);
      }

      // 启动下一次刷新
      if (this.isLiveMode) {
        this.liveInterval = setTimeout(() => this.refresh(), LiveModeManager.LIVE_REFRESH_INTERVAL) as unknown as number;
      }
    } catch (error) {
      console.error('[LiveModeManager] 刷新异常', error);
      this.callbacks.updateStatus('直播刷新异常');
    }
  }

  /**
   * 检测棋谱变化类型
   * - unchanged: 着法完全一致
   * - incremental: 新着法追加（前缀一致）
   * - changed: 着法减少或中间有变化（悔棋或棋谱重置）
   */
  private detectSgfChange(
    oldMoves: Array<{ x: number; y: number; color: PlayerColor }>,
    newMoves: Array<{ x: number; y: number; color: PlayerColor }>
  ): SgfChangeType {
    const oldCount = oldMoves.length;
    const newCount = newMoves.length;

    // 手数相同，检查内容是否一致
    if (newCount === oldCount) {
      for (let i = 0; i < oldCount; i++) {
        const oldMove = oldMoves[i];
        const newMove = newMoves[i];
        if (!oldMove || !newMove) continue;
        if (newMove.x !== oldMove.x || newMove.y !== oldMove.y || newMove.color !== oldMove.color) {
          return 'changed'; // 同手数但内容不同
        }
      }
      return 'unchanged';
    }

    // 手数减少 = 悔棋
    if (newCount < oldCount) {
      return 'changed';
    }

    // 手数增加，检查前缀是否一致
    for (let i = 0; i < oldCount; i++) {
      const oldMove = oldMoves[i];
      const newMove = newMoves[i];
      if (!oldMove || !newMove) continue;
      if (newMove.x !== oldMove.x || newMove.y !== oldMove.y || newMove.color !== oldMove.color) {
        return 'changed'; // 新手数但前缀不一致
      }
    }

    return 'incremental'; // 前缀一致，新手数追加
  }

  /**
   * 处理新增着法
   */
  private async processNewMoves(
    allMoves: Array<{ x: number; y: number; color: PlayerColor }>,
    fromMove: number,
    toMove: number
  ): Promise<void> {
    const newMoves = allMoves.slice(fromMove);
    if (newMoves.length === 0) return;

    console.info('[LiveModeManager] 新增着法:', newMoves.length, '手');

    // 追加着法到分析引擎
    const reviewId = this.analysis.getReviewId();
    if (reviewId) {
      this.reviewApp.appendMoves(reviewId, newMoves);
    }

    // 更新本地数据
    const currentMoves = this.callbacks.getMoves();
    this.callbacks.setMoves([...currentMoves, ...newMoves]);
    this.callbacks.setTotalMoves(toMove);

    // 分析所有新增着法的胜率
    if (reviewId && newMoves.length > 0) {
      const winrateTrend = this.callbacks.getWinrateTrend();
      const startMove = winrateTrend.length;

      for (let i = 0; i < newMoves.length; i++) {
        const moveIndex = startMove + i;
        try {
          const moveResult = await this.reviewApp.analyzePosition(reviewId, moveIndex, {
            visits: await this.analysis.getAnalysisVisits(),
            includePv: false
          });

          if (moveResult && moveResult.winRate !== undefined) {
            winrateTrend.push({
              moveNumber: moveIndex + 1,
              winRate: moveResult.winRate,
              scoreLead: moveResult.scoreLead ?? 0,
            });
          } else {
            // 分析无结果，用上一手胜率
            const prev = winrateTrend[winrateTrend.length - 1];
            winrateTrend.push(prev ? { ...prev, moveNumber: moveIndex + 1 } : { moveNumber: moveIndex + 1, winRate: 0.5, scoreLead: 0 });
          }
        } catch (e) {
          console.warn('[LiveModeManager] 分析第', moveIndex + 1, '手失败', e);
          const prev = winrateTrend[winrateTrend.length - 1];
          winrateTrend.push(prev ? { ...prev, moveNumber: moveIndex + 1 } : { moveNumber: moveIndex + 1, winRate: 0.5, scoreLead: 0 });
        }
      }

      this.callbacks.setWinrateTrend(winrateTrend);
      console.info('[LiveModeManager] 新增着法胜率分析完成');
    }

    // 保存复盘数据
    await this.analysis.saveReviewData(this.callbacks.getWinrateTrend());
    console.info('[LiveModeManager] 已保存新复盘数据');

    // 更新视图
    const currentMove = this.callbacks.getCurrentMove();
    const oldTotalMoves = fromMove;
    if (currentMove === oldTotalMoves - 1 || currentMove === oldTotalMoves) {
      this.callbacks.goToMove(toMove);
    }

    this.callbacks.updateWinrateChart(this.callbacks.getWinrateTrend(), this.callbacks.getCurrentMove());
    this.callbacks.updateDisplay(this.callbacks.getCurrentMove(), toMove);
  }

  /**
   * 重置并重新加载棋谱
   * @description 当检测到悔棋或棋谱完全变化时调用
   */
  private async resetAndReload(sgf: string, archiveId: string): Promise<void> {
    console.info('[LiveModeManager] 重置棋谱，重新加载');

    // 注意：不要清空 winrateTrend，因为 loadAndAnalyze 会触发完整的分析流程，
    // 分析完成后会通过 onAnalysisComplete 回调设置新的 winrateTrend
    
    // 重新分析整个棋谱（不传 baseMoves，让它从 SGF 中解析）
    await this.analysis.loadAndAnalyze(sgf, []);

    // 更新归档 ID
    this.analysis.setCurrentArchiveId(archiveId);
    this.previousArchiveId = archiveId;

    console.info('[LiveModeManager] 棋谱重置完成');
  }

  /**
   * 解析所有着法
   */
  private parseAllMoves(sgf: string): Array<{ x: number; y: number; color: PlayerColor }> {
    try {
      const parsed = this.sgfParser.parse(sgf);
      return parsed.moves.map((m) => {
        if (!m.coord || m.coord.length < 2) {
          return { x: -1, y: -1, color: sgfColorToPlayerColor(m.color as 'B' | 'W') };
        }
        return {
          x: m.coord.charCodeAt(0) - 97,
          y: m.coord.charCodeAt(1) - 97,
          color: sgfColorToPlayerColor(m.color as 'B' | 'W'),
        };
      });
    } catch (e) {
      console.warn('[LiveModeManager] SGF解析失败，fallback到正则:', e);
      return this.parseMovesByRegex(sgf);
    }
  }

  /**
   * 使用正则解析着法（fallback）
   */
  private parseMovesByRegex(sgf: string): Array<{ x: number; y: number; color: PlayerColor }> {
    const moves: Array<{ x: number; y: number; color: PlayerColor }> = [];
    const movePattern = /([BW])\[([a-z]{0,2})\]/g;
    let match;

    while ((match = movePattern.exec(sgf)) !== null) {
      const color = match[1] === 'B' ? 'black' : 'white';
      const coord = match[2];

      if (!coord || coord.length < 2) {
        moves.push({ x: -1, y: -1, color });
      } else {
        moves.push({
          x: coord.charCodeAt(0) - 97,
          y: coord.charCodeAt(1) - 97,
          color,
        });
      }
    }

    return moves;
  }

  /**
   * 检测末尾双 Pass
   */
  private isDoublePassAtEnd(moves: Array<{ x: number; y: number; color: PlayerColor }>): boolean {
    if (moves.length < 2) return false;
    const last = moves[moves.length - 1];
    const secondLast = moves[moves.length - 2];
    // Pass: x < 0 或 y < 0
    if (!last || !secondLast) return false;
    return (last.x < 0 || last.y < 0) && (secondLast.x < 0 || secondLast.y < 0);
  }

  /**
   * 格式化棋局结果
   */
  private formatGameResult(moves: Array<{ x: number; y: number; color: PlayerColor }>): string {
    // 统计有效手数（排除 Pass）
    const effectiveMoves = moves.filter(m => m.x >= 0 && m.y >= 0).length;
    return effectiveMoves + '手';
  }
}
