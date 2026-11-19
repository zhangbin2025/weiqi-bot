/**
 * 客户端入口
 * @module clients/web/assistant/main
 */

import { AssistantPage } from '../../../presentation/adapters/web/pages/assistant';
import '../../../domain/task/TaskBridge'; // 确保 TaskBridge 初始化代码被执行
import { resolveProxyUrl } from '../shared/resolveProxyUrl';
import { installLLMProxy } from '../../../infrastructure/llm/LLMProxyUrl';

// 登记代理 Promise（不 await）：LLM 请求侧 await 它，页面初始化不等它，
// App 桥接再慢也不拖 UI，且第一次请求不会先于注入发出。功能助手页的
// 意图识别已固定走本地流程，这里保留登记以备页面内其它 LLM 能力使用。
installLLMProxy(resolveProxyUrl());

// 初始化页面
const page = new AssistantPage();
page.init().catch(console.error);
