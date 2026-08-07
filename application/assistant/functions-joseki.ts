// functions-joseki.ts - 定式相关函数
import type { AIFunction } from './types';
/** 定式相关函数 */
export const josekiFunctions: AIFunction[] = [
  {
    name: 'explore_joseki',
    description: '探索定式变化',
    parameters: {
      opening: { type: 'string', description: '定式名称' },
      path: { type: 'array', description: '着法序列' },
    },
    execute: async (params, context) => {
      const result = await context?.services.joseki.explore(params.path || []);
      return result ?? { error: '探索失败' };
    },
  },
  {
    name: 'save_joseki',
    description: '保存定式到个人库',
    parameters: {
      name: { type: 'string', description: '定式名称', required: true },
      moves: { type: 'array', description: '着法序列', required: true },
      tags: { type: 'array', description: '标签' },
    },
    execute: async (params, context) => {
      await context?.services.joseki.addFavorite(params.moves);
      return { success: true, name: params.name, moves: params.moves, tags: params.tags };
    },
  },
  {
    name: 'start_joseki_quiz',
    description: '开始定式做题',
    parameters: {
      source: { type: 'string', enum: ['explore', 'discover', 'favorites'], description: '题库来源' },
      count: { type: 'number', description: '题目数量', default: 10 },
    },
    execute: async (params, context) => {
      context?.logger?.info('Starting joseki quiz', { source: params.source, count: params.count });
      context?.ui?.openPage('/joseki/quiz', { source: params.source, count: params.count ?? 10 });
      return { success: true, page: '/joseki/quiz' };
    },
  },
  {
    name: 'discover_joseki',
    description: '从棋谱中发现定式',
    parameters: {
      source: { type: 'string', enum: ['online', 'upload'], description: '棋谱来源', required: true },
      count: { type: 'number', description: '分析棋谱数量', default: 20 },
      date: { type: 'string', description: '日期（今天/昨天）' },
    },
    execute: async (params, context) => {
      context?.logger?.info('Discovering joseki', params);
      context?.ui?.openPage('/joseki/discover', params);
      return { success: true, page: '/joseki/discover' };
    },
    isLongRunning: true,
  },
];