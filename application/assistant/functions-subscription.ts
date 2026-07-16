// functions-subscription.ts - 订阅与记谱相关函数
import type { AIFunction } from './types';
/** 订阅与记谱函数 */
export const subscriptionFunctions: AIFunction[] = [
  {
    name: 'subscribe_daily_games',
    description: '订阅每日棋谱下载（下载野狐官网最新发布的棋谱）',
    parameters: {
      count: { type: 'number', description: '下载数量', default: 10 },
      time: { type: 'string', description: '执行时间（HH:mm 格式）', default: '08:00' },
    },
    execute: async (params, context) => {
      const scheduler = context?.scheduler;
      if (!scheduler) return { error: '调度服务不可用' };
      const [hour, minute] = (params.time || '08:00').split(':');
      const cron = `${minute} ${hour} * * *`;
      const jobId = await scheduler.add({
        name: `daily_public_games`,
        cron,
        handler: async () => {
          const urls = await context?.services.game.listPublicGames(undefined, params.count || 10);
          if (urls && urls.length > 0) {
            await context?.services.game.fetchMany(urls);
          }
        },
        enabled: true,
      });
      return { success: true, jobId, cron, count: params.count || 10 };
    },
  },
  {
    name: 'subscribe_event',
    description: '订阅围棋赛事通知',
    parameters: {
      keyword: { type: 'string', description: '赛事关键词', required: true },
    },
    execute: async (params, context) => {
      context?.logger?.info('Subscribing event', { keyword: params.keyword });
      const events = await context?.services.event?.search(params.keyword);
      if (events?.total) {
        context?.notification?.notify(`找到 ${events.total} 个相关赛事`);
      }
      return { success: true, keyword: params.keyword, eventsCount: events?.total ?? 0 };
    },
  },
  {
    name: 'start_recorder',
    description: '开始记谱（直播/线下）',
    parameters: {
      mode: { type: 'string', enum: ['live', 'offline'], description: '记谱模式', default: 'offline' },
    },
    execute: async (params, context) => {
      context?.logger?.info('Starting recorder', { mode: params.mode });
      context?.ui?.openPage('/recorder', { mode: params.mode ?? 'offline' });
      return { success: true, page: '/recorder' };
    },
  },
];