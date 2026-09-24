/**
 * @fileoverview 棋力评估领域层类型定义
 *
 * 纯函数、零外部依赖（不依赖 AI、不依赖存储）。
 * 输入为「棋手所下的每一手」的归一化数据，输出棋力信号与野狐段位估计。
 */

import type { PlayerColor } from '../primitives';

/** 恶手严重度 */
export type MoveSeverity = 'minor' | 'moderate' | 'severe';

/**
 * 单手棋的归一化输入（属于某棋手所下的手）
 */
export interface PlayerMoveInput {
  /** 落子坐标 */
  x: number;
  y: number;
  /** 该手后当前方胜率（0-1） */
  winRate: number;
  /** 该手后领先目差（当前方视角） */
  scoreLead: number;
  /** 是否为失误（胜率损失达到 minor 阈值） */
  isBadMove: boolean;
  /** 失误严重度（仅 isBadMove 为 true 时有意义） */
  severity?: MoveSeverity | undefined;
  /** 相对上一手的胜率变化（比例，如 -0.12），用于稳定性 */
  winRateChange?: number | undefined;
  /**
   * 该局面 AI 前若干选点（top-K）。
   * 缺省表示该局面无候选数据（如 Quick 模式或旧存档）。
   */
  candidates?:
    | Array<{
        x: number;
        y: number;
        winRate: number;
        scoreLead: number;
        visits: number;
      }>
    | undefined;
}

/** 命中档位 */
export type HitRank = 0 | 1 | 3 | 5;

/**
 * 棋力评估的中间信号（纯数据，便于单测）
 */
export interface StrengthSignals {
  /** 样本手数（该棋手落子总数） */
  samples: number;
  /** 候选数据可用手数（candidates 非空） */
  candidateSamples: number;
  /** top1 命中率 0-1 */
  agreeTop1: number;
  /** top3 命中率 0-1 */
  agreeTop3: number;
  /** top5 命中率 0-1 */
  agreeTop5: number;
  /** 失误率 0-1 */
  mistakeRate: number;
  /** 严重失误率 0-1 */
  severeRate: number;
  /** 中等失误率 0-1 */
  moderateRate: number;
  /** 轻微失误率 0-1 */
  minorRate: number;
  /**
   * 胜率稳定性：该棋手落子后己方胜率序列的波动率（0-1 归一）。
   * 越低越稳。
   */
  volatility: number;
}

/**
 * 棋力估计结果
 */
export interface StrengthEstimate {
  /** 该棋手颜色 */
  color: PlayerColor;
  /** 综合分数 0-100 */
  score: number;
  /** 野狐 dan 原始值（>=20 为业 N 段，见 mapScoreToFoxRank） */
  foxDan: number;
  /** 展示文案，如 "野狐 5段" */
  label: string;
  /** 信号明细 */
  signals: StrengthSignals;
  /** 可信度：high / medium / low（由样本量决定） */
  confidence: 'high' | 'medium' | 'low';
  /** 是否具备候选数据（命中率信号是否可用） */
  hasCandidateData: boolean;
}
