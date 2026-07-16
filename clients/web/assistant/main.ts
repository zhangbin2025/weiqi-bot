/**
 * 客户端入口
 * @module clients/web/assistant/main
 */

import { AssistantPage } from '../../../presentation/adapters/web/pages/assistant';
import '../../../domain/task/TaskBridge'; // 确保 TaskBridge 初始化代码被执行

// 初始化页面
const page = new AssistantPage();
page.init().catch(console.error);
