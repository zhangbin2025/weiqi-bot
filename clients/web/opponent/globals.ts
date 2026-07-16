/**
 * 全局导出模块
 * 供 HTML onclick 使用
 */

import type { OpponentAnalysisResultWithBookmark } from '../../application/opponent';
import { getCurrentResult } from './analyzer';
import { getFavorite, buildResultFromBookmark } from './favorites';
import { displayStats } from './display';
import { Dialog } from '../shared/ui';

// 全局变量引用（从 index.ts 注入）
let foxwqIdInput: HTMLInputElement;
let switchTabFn: (tabName: string) => void;

/**
 * 初始化全局导出
 */
export function initGlobals(
  input: HTMLInputElement,
  switchTab: (tabName: string) => void
): void {
  foxwqIdInput = input;
  switchTabFn = switchTab;
}

/**
 * 查看棋谱列表
 */
export function viewGames(): void {
  const currentResult = getCurrentResult();
  if (!currentResult?.games?.length) {
    void Dialog.alert('无棋谱数据');
    return;
  }

  // 通过 category 和 key 导航，传递 userId 用于高亮
  const params = new URLSearchParams({
    category: 'opponent',
    key: currentResult.foxwqId,
    userId: currentResult.foxwqId,
  });

  window.location.href = `../replay/list.html?${params.toString()}`;
}

/**
 * 查看定式列表
 */
export function viewJoseki(): void {
  const currentResult = getCurrentResult();
  if (!currentResult?.joseki?.patterns?.length) {
    void Dialog.alert('无定式数据');
    return;
  }

  // 通过 category 和 key 导航
  const params = new URLSearchParams({
    category: 'opponent',
    key: currentResult.foxwqId,
  });

  window.location.href = `../joseki/list.html?${params.toString()}`;
}

/**
 * 查看收藏
 */
export function viewFavorite(foxwqId: string): void {
  const bookmark = getFavorite(foxwqId);
  
  if (!bookmark || !bookmark.games) {
    void Dialog.alert('收藏数据不存在');
    return;
  }

  // 从收藏数据构造 currentResult
  const result = buildResultFromBookmark(bookmark);
  
  // 导入 setCurrentResult（避免循环依赖）
  import('./analyzer').then(({ setCurrentResult }) => {
    setCurrentResult(result);
  });

  // 切换到查询标签并显示结果
  switchTabFn('query');
  foxwqIdInput.value = foxwqId;
  
  // 获取 statsSection（从 DOM）
  const statsSection = document.getElementById('statsSection') as HTMLElement;
  if (statsSection) {
    displayStats(result, statsSection);
  }
}

/**
 * 注册全局函数
 */
export function registerGlobals(): void {
  (window as any).viewGames = viewGames;
  (window as any).viewJoseki = viewJoseki;
  (window as any).viewFavorite = viewFavorite;
}
