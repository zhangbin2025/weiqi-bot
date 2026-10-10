/**
 * PuzzlePage 状态管理
 * @module presentation/adapters/web/pages/puzzle/state/PuzzlePageState
 */
import type { ReplayData } from '../../../../../../domain/sgf';

/** 页面模式：solve=答题，study=研究（看答案 + 选点导航） */
export type PuzzleMode = 'solve' | 'study';

/** 页面状态数据 */
export interface PuzzlePageStateData {
  /** 当前题目 SGF 原文 */
  sgfContent: string | null;
  /** 当前题目归档ID（抓题时由 GameService 写入历史归档，供打谱页按 archiveId 打开） */
  archiveId: string;
  /** 解析后的打谱数据 */
  replayData: ReplayData | null;
  /** 当前题目标题（题号/题名） */
  title: string;
  /** 题目标签（内置题库为「类型·难度」） */
  tag: string;
  /** 题目来源 */
  source: string;
  /** 题目 URL */
  url: string;
  /** 当前模式 */
  mode: PuzzleMode;
  /** 是否已解出（走完某正解分支） */
  solved: boolean;
  /** 本题已尝试次数（答错重做累计） */
  attempts: number;
  /** 本题开始时间（毫秒），用于计时 */
  startedAt: number;
  /** 先手方（黑先/白先） */
  firstPlayer: 'B' | 'W';
  /** 单题模式：从 fetcher 跳过来只做一道题，禁用换题/筛选/来源切换 */
  singlePuzzle: boolean;
  /** 音效开关 */
  soundEnabled: boolean;
  /** 是否正在加载题目 */
  loading: boolean;
  /** 是否已初始化 */
  initialized: boolean;
}

/** 做题页面状态管理类 */
export class PuzzlePageState {
  private data: PuzzlePageStateData;

  constructor() {
    this.data = {
      sgfContent: null,
      archiveId: '',
      replayData: null,
      title: '',
      tag: '',
      source: '',
      url: '',
      mode: 'solve',
      solved: false,
      attempts: 0,
      startedAt: 0,
      firstPlayer: 'B',
      singlePuzzle: false,
      soundEnabled: true,
      loading: false,
      initialized: false,
    };
  }

  get<K extends keyof PuzzlePageStateData>(key: K): PuzzlePageStateData[K] {
    return this.data[key];
  }

  set<K extends keyof PuzzlePageStateData>(key: K, value: PuzzlePageStateData[K]): void {
    this.data[key] = value;
  }

  /** 重置单题状态（载入新题时调用，保留开关类偏好与单题模式） */
  resetForNewPuzzle(): void {
    this.data.solved = false;
    this.data.attempts = 0;
    this.data.startedAt = Date.now();
    this.data.mode = 'solve';
  }
}
