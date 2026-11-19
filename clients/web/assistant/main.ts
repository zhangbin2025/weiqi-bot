/**
 * 客户端入口
 * @module clients/web/assistant/main
 */

import { AssistantPage } from '../../../presentation/adapters/web/pages/assistant';
import '../../../domain/task/TaskBridge'; // 确保 TaskBridge 初始化代码被执行
import { resolveProxyUrl } from '../shared/resolveProxyUrl';
import { installLLMProxy } from '../../../infrastructure/llm/LLMProxyUrl';

// 功能助手页的意图解析同样会发 LLM 请求，端点不支持 CORS 时也必须走代理。
// 登记 Promise（不 await）：LLM 请求侧 await 它，页面初始化不等它，App 桥接
// 再慢也不拖 UI，且第一次请求不会先于注入发出。
installLLMProxy(resolveProxyUrl());

// 初始化页面
const page = new AssistantPage();
page.init().catch(console.error);
