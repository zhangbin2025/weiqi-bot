/**
 * 分析器模块
 */

import type { OpponentAnalysisResultWithBookmark } from '../../application/opponent';
import { displayStats, showLoading, showProgress, showError } from './display';
import { Dialog } from '../shared/ui';
import { TaskHelper } from '../shared/task-helper';

// 当前分析结果
let currentResult: OpponentAnalysisResultWithBookmark | null = null;

/**
 * 获取当前结果
 */
export function getCurrentResult(): OpponentAnalysisResultWithBookmark | null {
  return currentResult;
}

/**
 * 设置当前结果
 */
export function setCurrentResult(result: OpponentAnalysisResultWithBookmark | null): void {
  currentResult = result;
}

/**
 * 分析对手
 */
export async function analyzeOpponent(
  foxwqId: string,
  limit: number,
  analyzer: any,
  queryBtn: HTMLButtonElement,
  statsSection: HTMLElement,
  taskId?: string
): Promise<void> {
  if (!foxwqId) {
    await Dialog.alert('请输入野狐昵称');
    return;
  }

  // 禁用按钮
  queryBtn.disabled = true;
  queryBtn.textContent = '分析中...';
  statsSection.classList.remove('show');

  // 显示加载状态
  showLoading(statsSection, foxwqId);

  try {
    const result = await analyzer.analyze(foxwqId, {
      maxGames: limit,
      onProgress: (percent: number, status: string, detail?: string) => {
        showProgress(statsSection, percent, status, detail);
        
        // 后台任务进度通知
        TaskHelper.notifyProgress(taskId, percent, status + (detail ? `: ${detail}` : ''));
      },
    });

    currentResult = result;
    displayStats(result, statsSection);
    console.info('[OpponentPage] 对手分析完成', { foxwqId, gamesCount: result.games.length });

    // 后台任务完成通知
    if (taskId) {
      const gamesCount = result.games?.length || 0;
      const josekiCount = result.joseki?.count || 0;
      
      // 构造摘要消息（类似收藏条目）
      const message = `📋 ${gamesCount}局 🎯 ${josekiCount}定式\n\n[查看详情](/opponent/index.html?view=favorite&key=${encodeURIComponent(foxwqId)})`;
      
      // 检查是否是周期性任务（通过检查 URL 参数中的 scheduleId）
      const urlParams = new URLSearchParams(window.location.search);
      const scheduleId = urlParams.get('scheduleId');
      
      // 根据任务类型设置不同的 detailUrl
      const detailUrl = scheduleId 
        ? `/assistant?scheduleId=${scheduleId}`  // 周期性任务
        : `/assistant?taskId=${taskId}`;         // 一次性任务
      
      await TaskHelper.notifyComplete(
        taskId,
        foxwqId,
        message,
        detailUrl
      );
    }

  } catch (error) {
    showError(statsSection, (error as Error).message);
    console.error('[OpponentPage] 对手分析失败', error);

    // 后台任务失败通知
    TaskHelper.notifyFail(taskId, (error as Error).message || '未知错误');

  } finally {
    queryBtn.disabled = false;
    queryBtn.textContent = '开始分析';
  }
}
