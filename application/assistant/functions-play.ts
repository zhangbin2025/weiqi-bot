// functions-play.ts - 对弈与棋谱相关函数
import type { AIFunction } from './types';
/** 对弈与棋谱函数 */
export const playFunctions: AIFunction[] = [
  {
    name: 'start_play',
    description: '开始对弈（人机/真人/观摩）',
    parameters: {
      mode: { type: 'string', enum: ['hm', 'hh', 'mm'], description: '对弈模式：hm=人机, hh=真人, mm=观摩' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'AI 难度' },
    },
    execute: async (params, context) => {
      let targetPage = '/play';
      if (params.mode === 'hh') {
        targetPage = '/play/hh';
      } else if (params.mode === 'hm') {
        targetPage = '/play/hm';
      } else if (params.mode === 'mm') {
        targetPage = '/play/mm';
      }
      context?.ui?.openPage(targetPage, params);
      return { success: true, page: targetPage, params };
    },
  },
  {
    name: 'query_player',
    description: '查询棋手信息（等级分、段位）',
    parameters: {
      player: { type: 'string', description: '棋手姓名', required: true },
    },
    execute: async (params, context) => {
      context?.ui?.openPage('/player', params);
      return { success: true, page: '/player', params };
    },
  },
  {
    name: 'download_game',
    description: '下载棋谱',
    parameters: {
      url: { type: 'string', description: '棋谱链接' },
      player: { type: 'string', description: '棋手名（可选，按棋手下载）' },
      count: { type: 'number', description: '下载数量（按棋手下载时，默认5）' },
      source: { type: 'string', description: '平台' },
    },
    execute: async (params, context) => {
      context?.ui?.openPage('/fetcher', params);
      return { success: true, page: '/fetcher', params };
    },
  },
  {
    name: 'query_game',
    description: '查询特定棋谱信息',
    parameters: {
      gameId: { type: 'string', description: '棋谱 ID', required: true },
    },
    execute: async (params, context) => {
      const game = context?.services.game;
      if (!game) return { error: '服务不可用' };
      if (params.gameId.startsWith('http')) {
        const result = await game.fetch(params.gameId);
        if (result.success) {
          return {
            success: true, archiveId: result.archiveId,
            sgf: result.sgfContent, gameId: params.gameId,
            metadata: result.metadata,
          };
        }
        return { success: false, error: result.error };
      }
      return { error: '请提供完整的棋谱链接' };
    },
  },
  {
    name: 'get_ranking',
    description: '查询围棋排行榜',
    parameters: {
      type: { type: 'string', enum: ['world', 'china', 'korea', 'japan'], description: '排行榜类型' },
    },
    execute: async (params) => ({
      error: '排行榜功能暂未实现',
      suggestion: '可使用 query_player 查询特定棋手等级分',
      type: params.type || 'world',
    }),
  },
  {
    name: 'download_recent_games',
    description: '下载棋手最新棋谱',
    parameters: {
      player: { type: 'string', description: '棋手名', required: true },
      source: { type: 'string', enum: ['foxwq', 'ogs'], description: '平台' },
      count: { type: 'number', description: '下载数量', default: 5 },
    },
    execute: async (params, context) => {
      const game = context?.services.game;
      if (!game) return { error: '服务不可用' };
      const urls = await game.listPlayerGames(params.player, params.count || 5);
      if (urls.length === 0) return { error: '未找到棋谱' };
      return await game.fetchMany(urls);
    },
    isLongRunning: true,
  },
];