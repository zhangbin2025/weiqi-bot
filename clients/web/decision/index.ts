/**
 * 实战选点页面入口
 * @description 从野狐棋谱生成实战选点题
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DecisionPage } from '../../../presentation/adapters/web/pages/decision/DecisionPage';
import { DecisionApp } from '../../../application/decision/DecisionApp';
import { DecisionService } from '../../../services/decision/DecisionService';
import { WebAudioPlayer } from '../../../infrastructure/audio/WebAudioPlayer';
import { createGameDeps } from '../shared/deps/game';
import { loadHistoryList } from './history/list';
import { showGenerateResult } from './history/stats';
import { Dialog, Select } from '../shared/ui';
import { TaskHelper } from '../shared/task-helper';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 挂载页面自定义下拉框
  Select.mountAll();

  // 创建音频播放器
  const audioPlayer = new WebAudioPlayer();

  // 创建题目生成服务
  const { gameService } = await createGameDeps(ctx);
  const decisionService = new DecisionService();
  const favoriteService = ctx.favoriteService;
  const decisionApp = new DecisionApp(gameService, decisionService, favoriteService);

  // 标签切换逻辑
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset['tab'];
      
      // 切换标签激活状态
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 切换内容显示
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabName}-tab`) {
          content.classList.add('active');
        }
      });
    });
  });

  // 清空历史记录按钮
  // 必须在 handled return 之前注册，否则通过任务链接导航时不会执行到这里
  const clearBtn = document.getElementById('clear-btn');
  clearBtn?.addEventListener('click', async () => {
    if (await Dialog.confirm('确定要清空所有历史记录吗？')) {
      await decisionApp.clearHistory();
      await loadHistoryList(favoriteService);
    }
  });

  // 解析任务参数
  const taskParams = TaskHelper.parseTaskParams();
  
  // 处理任务参数
  const handled = await TaskHelper.handleTaskParams(taskParams, {
    onExecuteSchedule: async (params, scheduleId) => {
      const dateOffset = params.dateOffset || 1;  // 实战选点默认昨天
      const limit = params.limit || 50;
      const date = getDateStr(dateOffset);
      
      // 执行生成任务
      await executeGenerate(decisionApp, favoriteService, date, limit, scheduleId);
    },
    onViewFavorite: async (key) => {
      await viewFavorite(decisionApp, favoriteService, key);
    },
  });
  
  if (handled) {
    return; // 任务已处理，终止后续逻辑
  }

  // 正常页面加载逻辑
  console.log('[decision] Normal page load');

  // 生成题目按钮
  const generateBtn = document.getElementById('generate-btn');
  generateBtn?.addEventListener('click', async () => {
    const dateSelect = Select.get('#date-select');
    const limitSelect = Select.get('#limit-select');

    const dateOffset = parseInt(dateSelect?.getValue() || '1');
    const date = isNaN(dateOffset) ? undefined : getDateStr(dateOffset);
    const limit = limitSelect?.getValue() ? parseInt(limitSelect.getValue()) : 50;
    
    // 执行生成任务（前台模式）
    await executeGenerate(decisionApp, favoriteService, date, limit, taskParams.taskId);
  });

  // 加载历史记录列表
  await loadHistoryList(favoriteService);
  
  // 处理 URL 参数（自动执行）
  const urlParams = new URLSearchParams(window.location.search);
  const auto = urlParams.get('auto');
  
  if (auto === 'true') {
    // 移除 auto 参数，避免返回时重复触发
    urlParams.delete('auto');
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    
    // 自动触发生成任务（使用默认参数）
    const dateOffset = 1;  // 默认昨天
    const limit = 50;      // 默认 50
    const date = getDateStr(dateOffset);
    
    await executeGenerate(decisionApp, favoriteService, date, limit, taskParams.taskId);
  }
  
}

/**
 * 获取日期字符串
 */
function getDateStr(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

/**
 * 执行生成任务
 */
async function executeGenerate(
  decisionApp: DecisionApp,
  favoriteService: any,
  date: string | undefined,
  limit: number,
  taskId?: string
): Promise<void> {
  // 显示进度条
  const progressCard = document.getElementById('progress-card') as HTMLElement;
  const progressBar = document.getElementById('progress-bar') as HTMLElement;
  const progressText = document.getElementById('progress-text') as HTMLElement;
  
  if (progressCard) progressCard.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = '正在下载棋谱...';
  
  try {
    // 生成题目
    const result = await decisionApp.generateFromOnlineWithOptions(date, limit, {
      blunderFirst: true,
    }, (percent, status) => {
      // 更新进度
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = status;
      
      // 后台任务进度通知
      TaskHelper.notifyProgress(taskId, percent, status);
    });
    
    // 更新进度条
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = `生成完成！共 ${result.problems.length} 题`;
    
    // 后台任务完成通知
    // 检查是否是周期性任务（通过检查 URL 参数中的 scheduleId）
    const urlParams = new URLSearchParams(window.location.search);
    const scheduleId = urlParams.get('scheduleId');
    
    // 根据任务类型设置不同的 detailUrl
    const detailUrl = scheduleId 
      ? `/assistant?scheduleId=${scheduleId}`  // 周期性任务
      : `/assistant?taskId=${taskId}`;         // 一次性任务
    
    await TaskHelper.notifyComplete(
      taskId,
      '实战选点',
      `生成完成！共 ${result.problems.length} 题\n\n[查看题目](/decision/index.html?view=favorite&key=${encodeURIComponent(result.key || '')})`,
      detailUrl
    );
    
    // 刷新历史记录列表
    await loadHistoryList(favoriteService);
    
    // 显示统计卡片
    showGenerateResult(result);
    
    // 1秒后隐藏进度卡片
    setTimeout(() => {
      if (progressCard) progressCard.style.display = 'none';
    }, 1000);
    
  } catch (e) {
    console.error('题目生成失败', e instanceof Error ? e : new Error(String(e)));
    if (progressText) progressText.textContent = '生成失败，请重试';
    
    // 后台任务失败通知
    TaskHelper.notifyFail(taskId, (e as Error).message || '未知错误');
  }
}

/**
 * 查看收藏
 */
async function viewFavorite(
  decisionApp: DecisionApp,
  favoriteService: any,
  key: string
): Promise<void> {
  try {
    // 加载历史记录列表
    await loadHistoryList(favoriteService);
    
    // 从收藏加载题目
    const items = await favoriteService?.getFavorites({ category: 'decision_generate' });
    const item = items?.find((i: any) => i.key === key);
    
    if (!item) {
      await Dialog.alert('收藏数据不存在');
      return;
    }
    
    // 构造结果并显示（添加 favoriteId）
    const result = {
      ...item.data,
      favoriteId: item.id,  // 使用收藏 ID
    };
    showGenerateResult(result);
    
    // 切换到历史标签
    const historyTab = document.querySelector('[data-tab="history"]') as HTMLElement;
    historyTab?.click();
    
  } catch (error) {
    console.error('[decision] 查看收藏失败', error as Error);
    await Dialog.alert('加载收藏失败: ' + (error as Error).message);
  }
}

main().catch(console.error);
