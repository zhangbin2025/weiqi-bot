/**
 * 排名插件试算用的代表性对阵
 * @module domain/ranking/sampleInput
 *
 * 只用于 LLM 生成/修订插件时的沙箱试算，不是业务数据源。
 * 刻意覆盖：3 名真实选手、3 轮、含轮空、含未完赛（比分全 0），
 * 避免模型在 [] 上空跑试算通过、面对真实对阵才发现字段不存在。
 */

import type { RankingInput } from './types';

export const SAMPLE_RANKING_INPUT: RankingInput = {
  matches: [
    { bout: 1, table: 1, p1Id: 1, p1Name: '甲', p1Score: 2, p2Id: 2, p2Name: '乙', p2Score: 0 },
    { bout: 1, table: 2, p1Id: 3, p1Name: '丙', p1Score: 2, p2Id: 0, p2Name: '', p2Score: 0 },
    { bout: 2, table: 1, p1Id: 3, p1Name: '丙', p1Score: 0, p2Id: 1, p2Name: '甲', p2Score: 2 },
    { bout: 2, table: 2, p1Id: 2, p1Name: '乙', p1Score: 2, p2Id: 0, p2Name: '', p2Score: 0 },
    { bout: 3, table: 1, p1Id: 1, p1Name: '甲', p1Score: 0, p2Id: 2, p2Name: '乙', p2Score: 0 },
    { bout: 3, table: 2, p1Id: 3, p1Name: '丙', p1Score: 0, p2Id: 0, p2Name: '', p2Score: 0 },
  ],
};
