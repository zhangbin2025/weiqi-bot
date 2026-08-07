/**
 * 答题状态管理
 * @description 集中管理答题页面的全局状态
 */

import { WebBoard } from '../../../../presentation/adapters/web/components/Board';
import { Game } from '../../../../domain/game';
import { WebAudioPlayer } from '../../../../infrastructure/audio/WebAudioPlayer';
import { IExportService } from '../../../../services/export';
import { QuizProblem, STATE_MAIN, STATE_TRYPLAY, STATE_VARIATION } from './types';

/**
 * 全局状态对象
 */
export interface QuizState {
  board: WebBoard | null;
  game: Game | null;
  audioPlayer: WebAudioPlayer | null;
  exportService: IExportService | null; // 导出服务
  problems: QuizProblem[];
  currentIndex: number;
  currentState: string;
  answered: boolean;
  selectedOptionIndex: number | null;
  soundEnabled: boolean;
  currentMove: number;
  
  // 试下状态
  trialMoves: Array<{ x: number; y: number; color: 'B' | 'W' }>;
  trialIndex: number;
  savedMoveBeforeTrial: number;
  
  // 变化图状态
  currentVariation: Move[];
  variationIndex: number;
}

type Move = { color: 'B' | 'W'; coord: string };

/**
 * 全局状态实例
 */
export const state: QuizState = {
  board: null,
  game: null,
  audioPlayer: null,
  exportService: null, // 导出服务
  problems: [],
  currentIndex: 0,
  currentState: STATE_MAIN,
  answered: false,
  selectedOptionIndex: null,
  soundEnabled: true,
  currentMove: 0,
  trialMoves: [],
  trialIndex: 0,
  savedMoveBeforeTrial: 0,
  currentVariation: [],
  variationIndex: 0,
};

/**
 * 获取当前题目
 */
export function currentProblem(): QuizProblem {
  return state.problems[state.currentIndex]!;
}

/**
 * 重置答题状态
 */
export function resetAnswerState(): void {
  state.answered = false;
  state.selectedOptionIndex = null;
}

/**
 * 设置当前状态
 */
export function setState(newState: string): void {
  state.currentState = newState;
}

/**
 * 是否在主状态
 */
export function isMainState(): boolean {
  return state.currentState === STATE_MAIN;
}

/**
 * 是否在试下状态
 */
export function isTryplayState(): boolean {
  return state.currentState === STATE_TRYPLAY;
}

/**
 * 是否在变化图状态
 */
export function isVariationState(): boolean {
  return state.currentState === STATE_VARIATION;
}

/**
 * 播放音效
 */
export function playSound(type: 'stone' | 'capture' | 'pass' | 'error' | 'correct' | 'wrong'): void {
  if (state.soundEnabled && state.audioPlayer) {
    state.audioPlayer.play(type);
  }
}
