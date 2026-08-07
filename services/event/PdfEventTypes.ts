/**
 * PDF 导入比赛类型定义
 * @description PDF 对阵表导入后的持久化数据模型
 */

import type { Match } from './types';

/** PDF 导入的比赛 */
export interface PdfEvent {
  /** 主键（uuid） */
  id: string;
  /** 比赛名称（从PDF正标题提取，或用户输入） */
  title: string;
  /** 分组列表 */
  groups: PdfGroup[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 比赛分组 */
export interface PdfGroup {
  /** 主键（uuid） */
  id: string;
  /** 分组名称（如"初中组男子"） */
  name: string;
  /** 轮次列表 */
  rounds: PdfRound[];
}

/** 单轮对阵 */
export interface PdfRound {
  /** 轮次编号（第几轮） */
  round: number;
  /** 对阵列表（p1Score/p2Score 为胜负分：2=胜 0=负 1=和） */
  matches: Match[];
  /**
   * PDF 原始累计积分（选手名 → 累计积分）
   * 用于导入新一轮时回算上一轮的胜负
   * 第1轮的 pdfScores 全为 0（或空）
   */
  pdfScores: Record<string, number>;
  /** 导入时间 */
  importedAt: number;
}

/** sessionStorage 传递给 detail 页的数据 */
export interface PdfEventDetailRef {
  eventId: string;
  groupId: string;
}
