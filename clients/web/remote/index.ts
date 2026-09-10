/**
 * 远程隧道服务页面入口
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { RemotePage } from '../../../presentation/adapters/web/pages/remote/RemotePage';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const remotePage = new RemotePage(ctx.rootContainer);
  await remotePage.init();

  console.info('远程隧道服务页面已启动');
}

main().catch(console.error);
