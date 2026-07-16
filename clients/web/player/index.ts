/**
 * PlayerPage Web Shell
 * @description 组装 Player 专属依赖，通过 WebBootstrap 初始化通用基础设施
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DEFAULT_PLAYER_CONFIG } from '../shared/defaultConfig';
import { PlayerPage } from '../../../presentation/adapters/web/pages/player';
import { createPlayerDeps } from '../shared/deps/player';
import { TaskHelper } from '../shared/task-helper';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const { querier, formatter } = await createPlayerDeps(ctx);

  const page = new PlayerPage({
    playerQuerier: querier,
    logger: ctx.logger,
    adapterFactory: ctx.adapterFactory,
    formatter,
  });

  await page.initialize();
  page.render();

  // 解析任务参数
  const taskParams = TaskHelper.parseTaskParams();
  
  // 处理任务参数
  const handled = await TaskHelper.handleTaskParams(taskParams, {
    onExecuteSchedule: async (params, scheduleId) => {
      const name = params.player || params.name;
      if (name) {
        await page.executeQuery(name, scheduleId);
      }
    },
    onViewFavorite: async (key) => {
      page.viewBookmark(key);
    },
  });
  
  if (handled) {
    return; // 任务已处理，终止后续逻辑
  }

  // 正常页面加载逻辑
  const urlParams = new URLSearchParams(window.location.search);
  const auto = urlParams.get('auto');
  const nameParam = urlParams.get('name') || urlParams.get('player');
  
  if (auto === 'true' && nameParam) {
    // 执行后立即移除 auto 参数，避免返回时重复触发
    const newParams = new URLSearchParams();
    if (nameParam) newParams.set('player', nameParam);
    if (taskParams.taskId) newParams.set('taskId', taskParams.taskId);
    const newUrl = newParams.toString()
      ? `${window.location.pathname}?${newParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    
    // 自动触发查询（支持后台任务）
    await page.executeQuery(nameParam, taskParams.taskId || undefined);
  } else if (nameParam) {
    // 只填充输入框，不自动查询
    page.handleParams({ player: nameParam });
  }

  console.info('PlayerPage 已启动');
}

main().catch(console.error);

