/**
 * 题目列表页面入口
 * @description 按来源/棋谱分组显示生成的题目列表，点击进入答题
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { renderProblemList } from './problems/render';
import { showError } from './problems/utils';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const favoriteService = ctx.favoriteService;
  const readMarkService = ctx.readMarkService;
  const params = new URLSearchParams(window.location.search);
  const favoriteId = params.get('favoriteId');

  if (!favoriteId) {
    showError('缺少题目ID');
    return;
  }

  try {
    const fav = await favoriteService?.getById(favoriteId);
    
    if (!fav || !fav.data) {
      showError('题目不存在');
      return;
    }

    const label = (fav.data['label'] as string) || '未知';
    const problems = (fav.data['problems'] as any[]) || [];
    
    // 初始渲染
    await renderProblemList(problems, favoriteId, fav.data, readMarkService);
    
    // 监听 pageshow 事件，当页面从 bfcache 恢复时重新渲染
    window.addEventListener('pageshow', async (event) => {
      if (event.persisted) {
        await renderProblemList(problems, favoriteId, fav.data, readMarkService);
      }
    });

  } catch (e) {
    console.error('加载题目列表失败', e instanceof Error ? e : new Error(String(e)));
    showError('加载失败');
  }
}

main().catch(console.error);
