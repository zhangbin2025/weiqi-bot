/**
 * 直播模式管理器
 * @module presentation/adapters/web/pages/review/LiveModeManager
 *
 * 职责：
 * 1. 直播棋谱的加载和刷新
 * 2. 检测棋谱变化（着法序列 + SGF hash 对比，处理悔棋和棋谱重置）
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
import { formatGameResult as formatResultLabel } from '../../../../../domain/game/GameResult';

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
  /** 设置让子棋 */
  setHandicapStones: (stones: Array<{ x: number; y: number; color: PlayerColor }>) => void;
  /** 显示直播AI选点（返回 Promise，等待分析完成） */
  showLiveRecommendations: (moveIndex: number) => Promise<void>;
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
  /** 曾经进入过直播模式（直播结束后仍禁止复盘） */
  private wasLiveMode = false;
  /** 直播 URL */
  private liveUrl?: string;
  /** 刷新定时器 */
  private liveInterval: number | undefined = undefined;
  /** 上一次外层归档 ID（来自 gameService.fetch） */
  private previousArchiveId?: string;
  /** 上一次内层归档 ID（来自 loadAndAnalyze 的 saveToHistory，可能与外层不同） */
  private previousInnerArchiveId: string | undefined = undefined;
  /** 上一次着法列表（用于对比） */
  private lastMoves: Array<{ x: number; y: number; color: PlayerColor }> = [];
  /** 上一次 SGF 内容 hash（用于检测提子/添子等非着法变化） */
  private lastSgfHash = '';
  /** 连续刷新失败次数 */
  private liveFetchFailCount = 0;
  /** 连续失败阈值（超过则停止直播） */
  private static readonly LIVE_FETCH_FAIL_THRESHOLD = 10;
  /** 退避刷新间隔上限（毫秒） */
  private static readonly LIVE_REFRESH_MAX_INTERVAL = 120000;
  /** 刷新间隔（毫秒） */
  /** 刷新间隔（毫秒），默认5秒 */
  private refreshInterval = 5000;

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
    this.wasLiveMode = true;
    this.liveUrl = liveUrl;
    console.info('[LiveModeManager] 进入直播模式', { url: liveUrl });

    // 尝试从缓存恢复
    const cachedArchiveId = loadLiveArchiveId(liveUrl);
    if (cachedArchiveId) {
      console.info('[LiveModeManager] 从缓存恢复:', cachedArchiveId);
      this.previousArchiveId = cachedArchiveId;
      const restored = await this.viewFavorite(cachedArchiveId);
      if (restored) {
        // 同步 lastMoves，避免第一次 refresh 误判为增量更新
        this.lastMoves = this.callbacks.getMoves();
        // 缓存恢复时无法获取原始 SGF，lastSgfHash 留空，
        // 首次 refresh 时 hash 不同会触发 changed（安全重载）
        this.lastSgfHash = '';
        console.info('[LiveModeManager] 缓存恢复成功，lastMoves 已同步:', this.lastMoves.length, '手');
        return; // 缓存恢复成功
      }
      // 缓存恢复失败，继续执行正常抓取
      console.info('[LiveModeManager] 缓存恢复失败，重新抓取棋谱');
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
      this.lastSgfHash = this.computeSgfPrefixHash(sgf, moves.length);
      
      // 分析棋谱（fetch 已归档，直接用 archiveId，避免 historyManager 为 null 时丢失）
      await this.analysis.loadAndAnalyze(sgf, [], { skipArchive: true, archiveId: result.archiveId });

      // 追踪内层 archiveId（loadAndAnalyze 的 saveToHistory 可能产生不同的 archiveId）
      const innerArchiveId = this.analysis.getCurrentArchiveId();
      if (innerArchiveId && innerArchiveId !== result.archiveId) {
        this.previousInnerArchiveId = innerArchiveId;
      }

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
  private async viewFavorite(archiveId: string): Promise<boolean> {
    return await this.analysis.viewFavorite(archiveId);
  }

  /**
   * 启动直播刷新
   */
  start(): void {
    if (!this.isLiveMode || !this.liveUrl) return;
    // 已有定时器则不覆盖（避免 handleAnalysisComplete 的 start 覆盖 scheduleNextRefresh 的定时器）
    if (this.liveInterval) return;

    console.info('[LiveModeManager] 启动直播刷新（', this.refreshInterval / 1000, '秒间隔）');
    this.liveInterval = setTimeout(() => this.refresh(), this.refreshInterval) as unknown as number;
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
    
    // 不通知 UI 恢复控件（直播结束后仍保持禁用，只有跳转复盘才恢复）
    // this.callbacks.onLiveStop?.();
  }

  /**
   * 是否处于直播模式
   */
  isActive(): boolean {
    return this.isLiveMode;
  }
  /** 是否曾经进入过直播模式（直播结束后仍为 true） */
  wasLive(): boolean {
    return this.wasLiveMode;
  }

  /**
   * 获取当前直播归档 ID
   */
  /** 获取直播 URL */
  getLiveUrl(): string | undefined {
    return this.liveUrl;
  }

  getArchiveId(): string | undefined {
    return this.previousArchiveId;
  }

  /**
   * 安排下一次刷新
   * @description 统一的定时器管理：先清除旧定时器，再启动新的
   */
  private scheduleNextRefresh(): void {
    if (this.liveInterval) {
      clearTimeout(this.liveInterval);
      this.liveInterval = undefined;
    }
    if (this.isLiveMode) {
      this.liveInterval = setTimeout(() => this.refresh(), this.refreshInterval) as unknown as number;
    }
  }

  /**
   * 使用指定间隔调度下次刷新（退避策略用）
   */
  private scheduleNextRefreshWith(intervalMs: number): void {
    if (this.liveInterval) {
      clearTimeout(this.liveInterval);
      this.liveInterval = undefined;
    }
    if (this.isLiveMode) {
      this.liveInterval = setTimeout(() => this.refresh(), intervalMs) as unknown as number;
    }
  }

  /**
   * 刷新直播棋谱
   */
  private async refresh(): Promise<void> {
    if (!this.liveUrl) return;

    // 关键修复：如果正在分析，跳过本次刷新
    if (this.analysis.isAnalyzing()) {
      console.info('[LiveModeManager] 分析中，跳过本次刷新，等待下次定时');
      // 重新启动定时器，等待分析完成
      this.scheduleNextRefresh();
        return;
      }


    try {
      this.callbacks.updateStatus('直播中');

      // 2. 重新抓取棋谱
      console.info('[LiveModeManager] 开始刷新直播棋谱');
      const result = await this.gameService.fetch(this.liveUrl, true, 5000);

      if (!result.success || !result.archiveId) {
        console.warn('[LiveModeManager] 刷新失败:', result.error);
        this.liveFetchFailCount++;

        // 退避策略：连续失败时逐步增加刷新间隔
        const backoffInterval = Math.min(
          this.refreshInterval * Math.pow(1.5, this.liveFetchFailCount - 1),
          LiveModeManager.LIVE_REFRESH_MAX_INTERVAL
        );
        console.info('[LiveModeManager] 下次刷新间隔:', Math.round(backoffInterval / 1000), '秒');

        if (this.liveFetchFailCount >= LiveModeManager.LIVE_FETCH_FAIL_THRESHOLD) {
          console.info('[LiveModeManager] 连续刷新失败', this.liveFetchFailCount, '次，停止直播');
          this.stop();
          this.callbacks.updateStatus('直播连接失败，已停止刷新');
          return;
        }

        // ★ 关键修复：失败后仍要调度下次刷新，网络恢复后继续
        this.callbacks.updateStatus('直播刷新失败(' + this.liveFetchFailCount + ')，' + Math.round(backoffInterval / 1000) + '秒后重试');
        this.scheduleNextRefreshWith(backoffInterval);
        return;
      }

      // fetch 成功，重置失败计数
      this.liveFetchFailCount = 0;

      // 3. 检测棋局结束（方式1：从 metadata.result 检测）
      // 先记录结束标志，等着法更新完再停止直播，确保最后一手棋显示到棋盘
      let gameResult: string | null = null;
      if (result.metadata?.result && result.metadata.result !== '') {
        gameResult = result.metadata.result;
        console.info('[LiveModeManager] 棋局已结束（metadata结果:', gameResult, '）');
      }

      // 4. 获取新 SGF
      const newSgf = await this.gameService.getByArchiveId(result.archiveId);
      if (!newSgf) {
        console.warn('[LiveModeManager] 获取新SGF失败，跳过本次刷新');
        // fetch 已归档新文件，但本次无法使用，清理以防泄漏
        if (result.archiveId && result.archiveId !== this.previousArchiveId) {
          await this.cleanupArchiveById(result.archiveId);
        }
        // ★ 关键修复：SGF获取失败也继续刷新（临时问题，不计入失败计数）
        this.scheduleNextRefresh();
        return;
      }

      // 5. 检测棋局结束（方式2：从 SGF 的 RE[] 属性检测）
      const sgfResultMatch = newSgf.match(/RE\[([^\]]*)\]/);
      if (sgfResultMatch && sgfResultMatch[1] && sgfResultMatch[1] !== '') {
        gameResult = sgfResultMatch[1];
        console.info('[LiveModeManager] 棋局已结束（SGF结果:', gameResult, '）');
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
        gameResult = resultStr || '双Pass';
        console.info('[LiveModeManager] 棋局已结束（末尾双Pass）');
      }

      // ========== 核心改动：着法序列 + SGF hash 对比 ==========
      
      const changeType = this.detectSgfChange(this.lastMoves, newMoves, this.lastSgfHash, newSgf);
      
      console.info('[LiveModeManager] 棋谱变化检测:', changeType, {
        oldMoves: this.lastMoves.length,
        newMoves: newMovesCount,
        oldHash: this.lastSgfHash,
        newPrefixHash: this.computeSgfPrefixHash(newSgf, newMovesCount),
      });

      if (changeType === 'unchanged') {
        // 无变化，保留旧归档，跳过更新
        // 但 fetch 已创建新归档文件，需要删除（资源泄漏修复）
        if (result.archiveId && result.archiveId !== this.previousArchiveId) {
          await this.cleanupArchiveById(result.archiveId);
          console.info('[LiveModeManager] 棋谱未变化，已删除多余归档:', result.archiveId);
        }
        // 棋局已结束则停止刷新
        if (gameResult) {
          this.stop();
          this.callbacks.updateStatus('棋局已结束: ' + formatResultLabel(gameResult));
          return;
        }
        this.scheduleNextRefresh();
        return;
      }

      // 有变化，删除旧归档和旧复盘数据
      // 需要删除所有关联的 favorite 条目：
      // - recorder category（可能由之前 loadAndAnalyze 的 saveToHistory 创建）
      // - review_data category（由 saveReviewData 创建）
      // 注意：favorite 的 key 是 archiveId，但直播模式下可能存在两种 archiveId：
      //   1. 外层 fetch 返回的 archiveId（存于 this.previousArchiveId）
      //   2. 内层 saveToHistory 的 fetch 产生的 archiveId（存于 this.previousInnerArchiveId）
      await this.cleanupOldArchive();

      // 先更新归档 ID，确保 saveReviewData 存到正确的 key
      this.previousArchiveId = result.archiveId;
      this.analysis.setCurrentArchiveId(result.archiveId);

      if (changeType === 'incremental') {
        // 增量更新
        const fromMove = this.lastMoves.length;
        await this.processNewMoves(newMoves, fromMove, newMovesCount);
        this.lastMoves = newMoves;
        this.lastSgfHash = this.computeSgfPrefixHash(newSgf, newMovesCount);
      } else {
        // 棋谱变化（悔棋或重置）
        console.info('[LiveModeManager] 棋谱已变化（悔棋或重置），重新加载');
        await this.resetAndReload(newSgf, result.archiveId);
        this.lastMoves = newMoves;
        this.lastSgfHash = this.computeSgfPrefixHash(newSgf, newMovesCount);
      }

      // 更新缓存
      if (this.liveUrl) {
        saveLiveArchiveId(this.liveUrl, result.archiveId);
      }

      // 棋局结束后处理：着法已更新到棋盘，现在停止刷新
      if (gameResult) {
        this.stop();
        this.callbacks.updateStatus('棋局已结束: ' + formatResultLabel(gameResult));
        return;
      }

      // 启动下一次刷新
      this.scheduleNextRefresh();
    } catch (error) {
      console.error('[LiveModeManager] 刷新异常', error);
      this.callbacks.updateStatus('直播刷新异常');
      this.scheduleNextRefresh();
    }
  }

    /**
   * 提取 SGF 中前 N 手的棋盘相关内容并计算 hash
   * @description 用于增量检测：对比新旧 SGF 的前 N 手部分是否一致。
   * 如果前 N 手的 hash 不同，说明中间有提子/添子等变化，不能走增量路径。
   */
  private computeSgfPrefixHash(sgf: string, moveCount: number): string {
    // 提取前 moveCount 手的着法节点
    // SGF 结构: (;...;B[xx];W[yy];B[zz];...)
    // 找到所有着法节点
    const cleaned = sgf.replace(/\s+/g, '');

    // 收集棋盘相关属性
    const boardProperties: string[] = [];
    let moveIndex = 0;

    // 匹配所有属性 [KEY[value]]，包括 AB/AW/AE 等多值属性
    const propPattern = /([A-Z]+)((?:\[[^\]]*\])+)/g;
    let propMatch;
    let foundMoves = 0;

    // 按节点分割（以 ; 分隔）
    const nodes = cleaned.split(';');

    for (const node of nodes) {
      if (!node || node.length === 0) continue;

      let nodeHasMove = false;
      let nodeBoardProps = '';

      const nodePropPattern = /([A-Z]+)((?:\[[^\]]*\])+)/g;
      let m;
      while ((m = nodePropPattern.exec(node)) !== null) {
        const key = (m[1] ?? '').toUpperCase();
        if (key === 'B' || key === 'W') {
          nodeHasMove = true;
        }
        if (key === 'B' || key === 'W' || key === 'AB' || key === 'AW' || key === 'AE' || key === 'TB' || key === 'TW') {
          nodeBoardProps += m[0];
        }
      }

      if (nodeHasMove) {
        if (foundMoves >= moveCount) break;
        boardProperties.push(nodeBoardProps);
        foundMoves++;
      } else if (nodeBoardProps) {
        // 非着法节点但有棋盘属性（如根节点的 AB[] 让子），始终包含
        boardProperties.push(nodeBoardProps);
      }
    }

    const prefixContent = boardProperties.join('|');

    // DJB2 hash
    let hash = 5381;
    for (let i = 0; i < prefixContent.length; i++) {
      hash = ((hash << 5) + hash + prefixContent.charCodeAt(i)) & 0x7FFFFFFF;
    }
    return hash.toString(36);
  }

  /**
   * 检测棋谱变化类型
   * - unchanged: 着法完全一致 且 SGF hash 一致
   * - incremental: 新着法包含旧着法前缀 且 前缀部分 SGF hash 一致
   * - changed: 前缀不匹配 或 前缀 SGF hash 不一致（悔棋后重下、提子差异等）
   *
   * 重要：着法坐标一致不代表棋盘局面一致。
   * 比如悔棋后下了两步到同样的手数，着法坐标可能完全相同，
   * 但中间有提子变化，导致棋盘状态不同。
   * 因此额外用前缀 SGF hash 验证，避免误判 incremental。
   */
  private detectSgfChange(
    oldMoves: Array<{ x: number; y: number; color: PlayerColor }>,
    newMoves: Array<{ x: number; y: number; color: PlayerColor }>,
    oldSgfHash: string,
    newSgf: string
  ): SgfChangeType {
    const oldCount = oldMoves.length;
    const newCount = newMoves.length;

    // 手数相同，逐手比较
    if (newCount === oldCount) {
      // hash 一致（且非空），确定无变化
      if (oldSgfHash) {
        const newPrefixHash = this.computeSgfPrefixHash(newSgf, oldCount);
        if (oldSgfHash === newPrefixHash) {
          return 'unchanged';
        }
      }
      // hash 不同或为空（缓存恢复后首次刷新），检查着法是否相同
      for (let i = 0; i < oldCount; i++) {
        const oldMove = oldMoves[i];
        const newMove = newMoves[i];
        if (!oldMove || !newMove) continue;
        if (newMove.x !== oldMove.x || newMove.y !== oldMove.y || newMove.color !== oldMove.color) {
          return 'changed';
        }
      }
      // 着法坐标相同 → 视为无变化（SGF格式差异不影响棋盘局面）
      return 'unchanged';
    }

    // 统一用前缀匹配判断：新着法的前 oldCount 手是否与旧着法一致
    const minCount = Math.min(oldCount, newCount);
    for (let i = 0; i < minCount; i++) {
      const oldMove = oldMoves[i];
      const newMove = newMoves[i];
      if (!oldMove || !newMove) continue;
      if (newMove.x !== oldMove.x || newMove.y !== oldMove.y || newMove.color !== oldMove.color) {
        return 'changed';
      }
    }

    // 前缀着法一致
    if (newCount > oldCount) {
      // 着法前缀一致 → 视为增量追加（SGF格式差异不影响棋盘局面）
      return 'incremental';
    }
    return 'changed'; // 新手数更少但前缀一致（悔棋），重置
  }

  /**
   * 处理新增着法
   *
   * 修复：不再使用 appendModes 增量追加（会导致 rebuildBoard 着法序列不一致），
   * 而是销毁旧 reviewId 并用新 SGF 重新创建，确保着法序列完整正确。
   * 已有的胜率数据保留，只分析新增着法。
   */
  private async processNewMoves(
    allMoves: Array<{ x: number; y: number; color: PlayerColor }>,
    fromMove: number,
    toMove: number
  ): Promise<void> {
    const incrementalMoves = allMoves.slice(fromMove);
    if (incrementalMoves.length === 0) return;

    console.info('[LiveModeManager] 新增着法:', incrementalMoves.length, '手');

    // ★ 核心修复：销毁旧 reviewId 并用新 SGF 重新创建
    // 之前的 appendMoves 方式会导致 ReviewService.data.moves 和 ReviewPage.moves
    // 的着法序列不一致（因为 appendMoves 追加的着法来源与原始 loadFromSGF 解析的
    // 着法来源不同），从而在 rebuildBoard 或 KataGo 重放时出现
    // "该位置已有棋子"/"Illegal move" 错误。
    //
    // 用新 SGF 重新创建可以确保着法序列完整且正确，避免增量追加的不一致风险。
    const oldReviewId = this.analysis.getReviewId();
    if (oldReviewId) {
      console.info('[LiveModeManager] 销毁旧 reviewId:', oldReviewId);
      this.reviewApp.destroy(oldReviewId);
    }

    // 保存当前胜率数据（用于只分析新增着法）
    const existingWinrateTrend = this.callbacks.getWinrateTrend();

    // 用新 SGF 重新创建 reviewId
    const newSgf = await this.getNewSgf();
    if (!newSgf) {
      console.error('[LiveModeManager] 无法获取新 SGF，跳过增量更新');
      return;
    }

    // 重新加载棋谱
    const newReviewId = await this.reviewApp.loadFromSGF(newSgf);
    console.info('[LiveModeManager] 重新创建 reviewId:', newReviewId, '总手数:', allMoves.length);

    // 更新 analysis 的 reviewId
    this.analysis.setReviewId(newReviewId);

    // 更新让子棋信息（从新 SGF 解析）
    const newState = this.reviewApp.getState(newReviewId);
    if (newState) {
      this.callbacks.setHandicapStones(newState.handicapStones || []);
    }

    // 更新本地数据（全量替换）
    this.callbacks.setMoves(allMoves);
    this.callbacks.setTotalMoves(toMove);

    // 分析所有新增着法的胜率（批量评估，速度快）
    if (newReviewId && incrementalMoves.length > 0) {
      const startMove = existingWinrateTrend.length;
      const moveIndices = incrementalMoves.map((_, i) => startMove + i);

      try {
        const evals = await this.reviewApp.evaluateMovesBatch(newReviewId, moveIndices);
        for (const ev of evals) {
          existingWinrateTrend.push({
            moveNumber: ev.moveNumber,
            winRate: ev.winRate,
            scoreLead: ev.scoreLead,
          });
        }
      } catch (e) {
        console.warn('[LiveModeManager] 批量评估失败，使用上一手胜率填充', e);
        for (let i = 0; i < incrementalMoves.length; i++) {
          const prev = existingWinrateTrend[existingWinrateTrend.length - 1];
          existingWinrateTrend.push(prev ? { ...prev, moveNumber: startMove + i + 1 } : { moveNumber: startMove + i + 1, winRate: 0.5, scoreLead: 0 });
        }
      }

      this.callbacks.setWinrateTrend(existingWinrateTrend);
      console.info('[LiveModeManager] 新增着法胜率分析完成（batch）');
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

    // 等待直播AI选点分析完成（串行，确保选点分析完再启动下次刷新）
    await this.callbacks.showLiveRecommendations(toMove);
  }

  /**
   * 获取当前直播的最新 SGF
   * @description 从 gameService 获取当前归档的 SGF
   */
  private async getNewSgf(): Promise<string | null> {
    if (!this.previousArchiveId) return null;
    try {
      return await this.gameService.getByArchiveId(this.previousArchiveId) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 重置并重新加载棋谱
   * @description 当检测到悔棋或棋谱完全变化时调用
   */
  private async resetAndReload(sgf: string, archiveId: string): Promise<void> {
    // 先销毁旧的 reviewId，避免内存泄漏
    const oldReviewId = this.analysis.getReviewId();
    if (oldReviewId) {
      console.info('[LiveModeManager] 销毁旧 reviewId:', oldReviewId);
      this.reviewApp.destroy(oldReviewId);
    }

    console.info('[LiveModeManager] 重置棋谱，重新加载, SGF着法数:', this.parseAllMoves(sgf).length);

    // 重新分析整个棋谱
    // skipArchive: 棋谱已在外层 gameService.fetch 中归档，无需再次归档
    // archiveId: 使用外层 fetch 返回的 archiveId
    await this.analysis.loadAndAnalyze(sgf, [], { skipArchive: true, archiveId });

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


  /**
   * 设置刷新间隔
   * @param seconds 刷新间隔（5~30秒）
   */
  setRefreshInterval(seconds: number): void {
    this.refreshInterval = Math.max(5, Math.min(30, seconds)) * 1000;
    console.info('[LiveModeManager] 刷新间隔已设置为:', seconds, '秒');
  }

  /**
   * 获取当前刷新间隔（秒）
   */
  getRefreshInterval(): number {
    return this.refreshInterval / 1000;
  }

  /**
   * 清理指定归档 ID 的所有关联条目（favorite + history + file）
   * @description 删除 recorder/review_data 的 favorite 条目和 game history 归档
   */
  private async cleanupArchiveById(archiveId: string): Promise<void> {
    try {
      // 删除 recorder category 的 favorite
      const recorderItem = await this.favoriteService.getFavorite('recorder', archiveId);
      if (recorderItem?.id) {
        await this.favoriteService.removeFavorite(recorderItem.id);
      }
      // 删除 review_data category 的 favorite
      const reviewItem = await this.favoriteService.getFavorite('review_data', archiveId);
      if (reviewItem?.id) {
        await this.favoriteService.removeFavorite(reviewItem.id);
      }
      // 删除 game history 归档（包括索引和文件）
      if ((this.gameService as any).historyStorage) {
        try {
          await (this.gameService as any).historyStorage.delete(archiveId);
        } catch (e) {
          // 忽略
        }
      }
    } catch (e) {
      // 忽略删除失败
    }
  }

  /**
   * 清理旧归档的所有关联条目
   * @description 删除 recorder/review_data 的 favorite 条目和 game history 归档
   */
  private async cleanupOldArchive(): Promise<void> {
    const archiveIds = [this.previousArchiveId, this.previousInnerArchiveId].filter(Boolean) as string[];
    this.previousInnerArchiveId = undefined; // 重置内层 ID

    for (const archiveId of archiveIds) {
      await this.cleanupArchiveById(archiveId);
      console.info('[LiveModeManager] 已清理旧归档:', archiveId);
    }
  }
}
