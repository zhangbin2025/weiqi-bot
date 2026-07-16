/**
 * 人机对弈草稿管理器
 */

import type { HMPlayDraft } from './HMPlayDraftTypes';
import { HM_PLAY_DRAFT_KEY } from './HMPlayDraftTypes';

/**
 * 人机对弈草稿管理器
 */
export class HMPlayDraftManager {
  /**
   * 保存草稿
   */
  save(draft: HMPlayDraft): void {
    try {
      const json = JSON.stringify(draft);
      localStorage.setItem(HM_PLAY_DRAFT_KEY, json);
    } catch (error) {
      console.error('[HMPlayDraftManager] 保存草稿失败', error);
    }
  }

  /**
   * 加载草稿
   */
  load(): HMPlayDraft | null {
    try {
      const json = localStorage.getItem(HM_PLAY_DRAFT_KEY);
      if (!json) return null;
      return JSON.parse(json) as HMPlayDraft;
    } catch (error) {
      console.error('[HMPlayDraftManager] 加载草稿失败', error);
      return null;
    }
  }

  /**
   * 清除草稿
   */
  clear(): void {
    try {
      localStorage.removeItem(HM_PLAY_DRAFT_KEY);
    } catch (error) {
      console.error('[HMPlayDraftManager] 清除草稿失败', error);
    }
  }
}
