/**
 * 对手分析页面入口
 * @description Web Shell 对手分析页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { createOpponentDeps } from '../shared/deps/opponent';
import { analyzeOpponent } from './analyzer';
import { displayStats } from './display';
import { loadFavorites, clearFavorites } from './favorites';
import { initGlobals, registerGlobals, viewFavorite } from './globals';
import { Select } from '../shared/ui';
import type { SelectInstance } from '../shared/ui';
import { TaskHelper } from '../shared/task-helper';

// DOM 元素
let foxwqIdInput: HTMLInputElement;
let limitSelect: SelectInstance;
let queryBtn: HTMLButtonElement;
let statsSection: HTMLElement;
let favoritesList: HTMLElement;
let clearBtn: HTMLButtonElement;

// 分析器
let analyzer: any;

/**
 * 主入口
 */
async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'statsSection',
    moduleConfigs: {
      joseki: {
        dataUrl: '../shared/assets/data/joseki',
        trieMetaFile: 'trie-meta.json',
        enableDynamicLoad: false,
      },
    },
  });

  const deps = await createOpponentDeps(ctx);
  analyzer = deps.analyzer;

  // 2. 获取 DOM 元素
  foxwqIdInput = document.getElementById('foxwqIdInput') as HTMLInputElement;
  queryBtn = document.getElementById('queryBtn') as HTMLButtonElement;
  statsSection = document.getElementById('statsSection') as HTMLElement;
  favoritesList = document.getElementById('favoritesList') as HTMLElement;
  clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

  // 挂载自定义下拉框
  Select.mountAll();
  limitSelect = Select.get('#limitSelect')!;

  // 3. 设置事件监听
  setupEventListeners();

  // 4. 初始化全局变量（必须在处理任务参数之前）
  initGlobals(foxwqIdInput, switchTab);
  registerGlobals();

  // 5. 解析任务参数
  const taskParams = TaskHelper.parseTaskParams();
  
  // 6. 处理任务参数
  const handled = await TaskHelper.handleTaskParams(taskParams, {
    onExecuteSchedule: async (params, scheduleId) => {
      const player = params.player;
      const limit = params.limit || 10;  // 对手分析默认 10 局
      await analyzeOpponent(player, limit, analyzer, queryBtn, statsSection, scheduleId);
    },
    onViewFavorite: async (key) => {
      await handleLoadFavorites();
      viewFavorite(key);
    },
  });
  
  if (handled) {
    return; // 任务已处理，终止后续逻辑
  }

  // 7. 正常页面加载逻辑
  console.log('[opponent] Normal page load');

  // 7. 处理 URL 参数（普通模式）
  const urlParams = new URLSearchParams(window.location.search);
  const auto = urlParams.get('auto');
  const foxwqIdParam = urlParams.get('foxwqId') || urlParams.get('player');
  const taskId = taskParams.taskId; // 从 taskParams 获取
  
  if (foxwqIdParam) {
    foxwqIdInput.value = foxwqIdParam;
    if (auto === 'true') {
      // 执行后立即移除 auto 参数，避免返回时重复触发
      urlParams.delete('auto');
      if (taskId) urlParams.set('taskId', taskId); // 保留 taskId
      const newUrl = urlParams.toString()
        ? `${window.location.pathname}?${urlParams.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      
      // 传递 taskId 给分析器
      handleAnalyze(taskId);
    }
  }

  console.info('OpponentPage 已启动');
}

/**
 * 设置事件监听
 */
function setupEventListeners() {
  // 标签切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      if (tabName) switchTab(tabName);
    });
  });

  // 查询按钮
  queryBtn.addEventListener('click', () => handleAnalyze());

  // 输入框回车
  foxwqIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAnalyze();
  });

  // 清除收藏
  clearBtn.addEventListener('click', () => handleClearFavorites());
}

/**
 * 切换标签
 */
function switchTab(tabName: string) {
  // 切换标签样式
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`.tab[data-tab="${tabName}"]`)?.classList.add('active');

  // 切换内容面板
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}Panel`)?.classList.add('active');

  // 切换到收藏时加载收藏列表
  if (tabName === 'favorites') {
    handleLoadFavorites();
  }
}

/**
 * 处理分析请求
 */
async function handleAnalyze(taskId?: string) {
  const foxwqId = foxwqIdInput.value.trim();
  const limit = parseInt(limitSelect.getValue());
  await analyzeOpponent(foxwqId, limit, analyzer, queryBtn, statsSection, taskId);
}

/**
 * 加载收藏列表
 */
async function handleLoadFavorites() {
  await loadFavorites(analyzer, favoritesList);
}

/**
 * 清除收藏
 */
async function handleClearFavorites() {
  await clearFavorites(analyzer, favoritesList);
}

// 启动应用
main().catch(console.error);
