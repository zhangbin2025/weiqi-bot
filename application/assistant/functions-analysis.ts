// functions-analysis.ts - 分析与复盘相关函数
import type { AIFunction } from './types';
/** 分析与复盘函数 */
export const analysisFunctions: AIFunction[] = [
  {
    name: 'analyze_opponent',
    description: '分析对手棋谱，发现定式规律',
    parameters: {
      player: { type: 'string', description: '对手名', required: true },
      maxGames: { type: 'number', description: '分析棋谱数量', default: 10 },
    },
    execute: async (params, context) => {
      context?.ui?.openPage('/opponent', params);
      return { success: true, page: '/opponent', params };
    },
  },
  {
    name: 'analyze_game',
    description: '深度分析棋谱',
    parameters: {
      gameId: { type: 'string', description: '棋谱 ID', required: true },
      depth: { type: 'number', description: '分析深度', default: 20 },
    },
    execute: async (params, context) => {
      const analysis = context?.services.analysis;
      if (!analysis) return { error: '分析服务不可用' };
      const game = context?.services.game;
      if (!game) return { error: '棋谱服务不可用' };
      if (!params.gameId.startsWith('http')) {
        return { error: '需要完整的棋谱链接' };
      }
      const result = await game.fetch(params.gameId);
      if (!result.success || !result.sgfContent) {
        return { error: '棋谱下载失败' };
      }
      if (!analysis.isInitialized()) {
        return { error: '分析服务未初始化，请先加载模型' };
      }
      context?.onProgress?.(50, '正在分析...');
      return {
        success: true, archiveId: result.archiveId, gameId: params.gameId,
        message: '分析功能需要 SGF 解析器支持',
        sgf: result.sgfContent.substring(0, 100) + '...',
        metadata: result.metadata,
      };
    },
    isLongRunning: true,
  },
  {
    name: 'start_review',
    description: '开始AI复盘分析',
    parameters: {
      sgf: { type: 'string', description: 'SGF棋谱内容或链接', required: true },
      visits: { type: 'number', description: 'AI计算量', default: 100 },
    },
    execute: async (params, context) => {
      context?.logger?.info('Starting review', { sgf: params.sgf?.substring(0, 50) });
      context?.ui?.openPage('/review', { sgf: params.sgf, visits: params.visits ?? 100 });
      return { success: true, page: '/review' };
    },
    isLongRunning: true,
  },
  {
    name: 'generate_decision',
    description: '从AI分析棋谱中提取实战决策题，支持恶手检测和难度筛选',
    parameters: {
      sgf: { type: 'string', description: 'SGF棋谱内容', required: true },
      maxCount: { type: 'number', description: '最大题目数', default: 5 },
      difficulty: { type: 'string', description: '难度筛选', enum: ['easy', 'medium', 'hard', 'blunder'] },
      phase: { type: 'string', description: '阶段筛选', enum: ['layout', 'middle', 'endgame'] },
    },
    execute: async (params, context) => {
      const decision = context?.services.decision;
      if (!decision) return { error: '决策服务不可用' };
      const result = await decision.generateFromSGF(params.sgf, {
        maxCount: params.maxCount ?? 5,
        difficulty: params.difficulty,
        phase: params.phase,
      });
      return {
        success: true, count: result.totalCount, stats: result.stats,
        problems: result.problems.map(p => ({
          id: p.id, phase: p.phase, difficulty: p.difficulty,
          moveNumber: p.metadata.moveNumber, optionsCount: p.options.length,
        })),
      };
    },
  },
];