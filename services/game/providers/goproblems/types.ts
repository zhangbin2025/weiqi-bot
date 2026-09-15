/**
 * @fileoverview goproblems.com 类型定义
 */

/**
 * 题目难度等级
 */
export interface GoProblemsRank {
  /** 等级数值 */
  value: number;
  /** 单位: 'kyu' | 'dan' */
  unit: string;
  /** 是否精确 */
  exact: boolean;
  /** 是否标记 */
  mark: boolean;
}

/**
 * 题目作者
 */
export interface GoProblemsAuthor {
  id: number;
  name: string;
  rank?: GoProblemsRank | null;
  elo?: number;
}

/**
 * 题目列表项（/api/v2/problems）
 */
export interface GoProblemsListItem {
  id: number;
  imageUrl?: string;
  rank?: GoProblemsRank | null;
  createdAt?: string;
  author?: GoProblemsAuthor;
  genre?: string;
  rating?: { stars: number; votes: number } | null;
}

/**
 * 题目详情（/api/v2/problems/{id}）
 */
export interface GoProblemsProblemDetail {
  id: number;
  sgf: string;
  rank?: GoProblemsRank | null;
  genre: string;
  specificGenre?: string;
  description?: string;
  source?: string;
  playerColor?: string;
  author?: GoProblemsAuthor;
  createdAt?: string;
  elo?: number;
  avgSolveTimeSeconds?: number;
  attempts?: {
    solved: number;
    failed: number;
    tries: number;
  };
  rating?: { stars: number; votes: number } | null;
}
