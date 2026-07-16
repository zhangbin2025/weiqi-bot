/**
 * 存储适配器导出
 * @description 按环境分类导出不同的适配器实现
 */

// 通用适配器（跨平台）
export * from './common';

// Web (浏览器) 环境
export * from './web';

// CLI (Node.js) 环境
export * from './cli';

// 小程序环境
export * from './miniprogram';

// 任务存储适配器
export * from './task';

// App (React Native) 环境
export * from './app';
