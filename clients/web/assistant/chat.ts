/**
 * AI 对话页入口
 * @module clients/web/assistant/chat
 *
 * 独立页面，不引入功能页的意图识别、命令体系与 TaskBridge。
 * 模型配置在功能助手完成（凭据同源 localStorage，这里只读）。
 */

import { ChatPage } from '../../../presentation/adapters/web/pages/assistant/ChatPage';
import { resolveProxyUrl } from '../shared/resolveProxyUrl';
import { installLLMProxy } from '../../../infrastructure/llm/LLMProxyUrl';
import { installTokenUsageRecorder } from '../../../infrastructure/token/installTokenUsageRecorder';

// Token 统计旁路：越早装配越好，覆盖本页初始化期间可能发生的任何 LLM 请求。
// 幂等，ChatPage.init 内再调一次也不会双记。
installTokenUsageRecorder();

const page = new ChatPage();
// 附件按钮先绑定：App 端 window.prompt('config:get') 是原生桥接，可能挂起；
// IndexedDB / 插件初始化也可能慢。这些都不该让用户点 📎 毫无反应。
page.bindEarlyUI();
// 三端代理分流在 vite 域算好，登记给 LLM 层（注册表在 tsc 域，不能碰
// import.meta.env）。登记的是同一个 Promise：LLM 请求侧 await 它，页面初始化
// 不等它，App 桥接再慢也不会拖住 UI，且第一次请求绝不会先于注入发出。
const proxyResolution = resolveProxyUrl();
installLLMProxy(proxyResolution);
// 网络工具用的 proxyUrl 仍是已解析的字符串，继续沿用原有注入路径。
proxyResolution.then((proxyUrl) => page.init({ proxyUrl })).catch((error) => {
  console.error('[ChatPage] 初始化失败:', error);
  const banner = document.getElementById('notReady');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = '对话页初始化失败，请刷新重试或回到功能助手。';
  }
});
