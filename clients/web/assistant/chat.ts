/**
 * AI 对话页入口
 * @module clients/web/assistant/chat
 *
 * 独立页面，不引入功能页的意图识别、命令体系与 TaskBridge。
 * 模型配置在功能助手完成（凭据同源 localStorage，这里只读）。
 */

import { ChatPage } from '../../../presentation/adapters/web/pages/assistant/ChatPage';

const page = new ChatPage();
page.init().catch((error) => {
  console.error('[ChatPage] 初始化失败:', error);
  const banner = document.getElementById('notReady');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = '对话页初始化失败，请刷新重试或回到功能助手。';
  }
});
