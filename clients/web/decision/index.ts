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

  // 生成题目按钮（在 handled 检查之前注册，确保任务链接进入时按钮也可用）
  const generateBtn = document.getElementById('generate-btn');
  generateBtn?.addEventListener('click', async () => {
    const sourceSelect = Select.get('#source-select');
    const dateSelect = Select.get('#date-select');
    const limitSelect = Select.get('#limit-select');

    const source = sourceSelect?.getValue() || 'foxwq';
    const dateValue = dateSelect?.getValue() || '';
    const dateOffset = dateValue ? parseInt(dateValue) : NaN;
    const date = isNaN(dateOffset) ? undefined : getDateStr(dateOffset);
    const limit = limitSelect?.getValue() ? parseInt(limitSelect.getValue()) : 20;
    
    // 执行生成任务（前台模式）
    await executeGenerate(decisionApp, favoriteService, date, limit, taskParams.taskId, source);
  });

  // 导入棋谱：选择文件 + 生成恶手题
  const importFile = document.getElementById('import-file') as HTMLInputElement | null;
  const importDrop = document.getElementById('import-drop') as HTMLElement | null;
  const importFileLabel = document.getElementById('import-file-label') as HTMLElement | null;
  const importBtn = document.getElementById('import-btn') as HTMLButtonElement | null;
  let importSgfContent: string | null = null;
  let importFileName = '';

  importFile?.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    importSgfContent = await file.text();
    importFileName = file.name.replace(/\.sgf$/i, '');
    if (importFileLabel) importFileLabel.textContent = file.name;
    importDrop?.classList.add('has-file');
    if (importBtn) importBtn.disabled = false;
  });

  importBtn?.addEventListener('click', async () => {
    if (!importSgfContent) {
      await Dialog.alert('请先选择 SGF 文件');
      return;
    }
    await executeImport(decisionApp, favoriteService, importSgfContent, importFileName);
  });

  // 解析任务参数
  const taskParams = TaskHelper.parseTaskParams();
  
  // 处理任务参数
  const handled = await TaskHelper.handleTaskParams(taskParams, {
    onExecuteSchedule: async (params, scheduleId) => {
      const dateOffset = params.dateOffset || 1;  // 实战选点默认昨天
      const limit = params.limit || 20;
      const source = params.source || 'foxwq';
      const date = getDateStr(dateOffset);
      
      // 执行生成任务
      await executeGenerate(decisionApp, favoriteService, date, limit, scheduleId, source);
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
    const limit = 20;      // 默认 20
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
 * 执行导入棋谱生成任务
 */
async function executeImport(
  decisionApp: DecisionApp,
  favoriteService: any,
  sgfContent: string,
  fileName: string,
): Promise<void> {
  const progressCard = document.getElementById('progress-card') as HTMLElement;
  const progressBar = document.getElementById('progress-bar') as HTMLElement;
  const progressText = document.getElementById('progress-text') as HTMLElement;

  if (progressCard) progressCard.style.display = 'block';
  if (progressBar) progressBar.style.width = '30%';
  if (progressText) progressText.textContent = '正在解析棋谱...';

  // 自动识别来源：OGS 胜率注释为黑方视角，需翻转；野狐已是当前方视角
  const isOgs = /胜率[:\s]*\d+\.?\d*%/.test(sgfContent);
  const source = isOgs ? 'ogs' : 'foxwq';

  try {
    const result = await decisionApp.generateFromSGFContent(sgfContent, {
      source,
      fileName,
    });

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = `生成完成！共 ${result.problems.length} 题`;

    // 刷新历史并展示结果
    await loadHistoryList(favoriteService);
    showGenerateResult(result);

    // 切换到历史标签，展示新生成的记录
    (document.querySelector('[data-tab="history"]') as HTMLElement)?.click();

    if (!result.problems.length) {
      await Dialog.alert('该棋谱未检测到题目，请确认棋谱包含 AI 复盘数据（野狐/OGS 选点胜率）');
    }

    setTimeout(() => {
      if (progressCard) progressCard.style.display = 'none';
    }, 1000);
  } catch (e) {
    console.error('导入棋谱生成失败', e instanceof Error ? e : new Error(String(e)));
    if (progressText) progressText.textContent = '生成失败，请重试';
    await Dialog.alert('生成失败：' + ((e as Error).message || '未知错误'));
  }
}

/**
 * 执行生成任务
 */
async function executeGenerate(
  decisionApp: DecisionApp,
  favoriteService: any,
  date: string | undefined,
  limit: number,
  taskId?: string,
  source?: string
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
      source: source || 'foxwq',
      blunderOnly: true,
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

    // 滚动到底部，让用户看到结果卡片
    setTimeout(() => {
      const statsSection = document.getElementById('stats-section');
      if (statsSection) {
        statsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }, 300);

  } catch (error) {
    console.error('[decision] 查看收藏失败', error as Error);
    await Dialog.alert('加载收藏失败: ' + (error as Error).message);
  }
}

main().catch(console.error);
