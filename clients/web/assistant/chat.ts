/**
 * AI 对话页入口
 * @module clients/web/assistant/chat
 *
 * 独立页面，不引入功能页的意图识别、命令体系与 TaskBridge。
 * 模型配置在功能助手完成（凭据同源 localStorage，这里只读）。
 */

import { ChatPage } from '../../../presentation/adapters/web/pages/assistant/ChatPage';
import { resolveProxyUrl } from '../shared/resolveProxyUrl';

const page = new ChatPage();
// 附件按钮先绑定：App 端 window.prompt('config:get') 是原生桥接，可能挂起；
// IndexedDB / 插件初始化也可能慢。这些都不该让用户点 📎 毫无反应。
page.bindEarlyUI();
// 三端代理分流在 vite 域的入口算好，注入页面；ChatPage 在 tsc 依赖图内，
// 不直接引用 import.meta.env，避免类型缺失也避免破坏 vite 的字面替换。
resolveProxyUrl().then((proxyUrl) => page.init({ proxyUrl })).catch((error) => {
  console.error('[ChatPage] 初始化失败:', error);
  const banner = document.getElementById('notReady');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = '对话页初始化失败，请刷新重试或回到功能助手。';
  }
});
