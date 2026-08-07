/**
 * AI自对弈草稿管理器
 */

import type { MMPlayDraft } from './MMPlayDraftTypes';
import { MM_PLAY_DRAFT_KEY } from './MMPlayDraftTypes';

/**
 * AI自对弈草稿管理器
 */
export class MMPlayDraftManager {
  /**
   * 保存草稿
   */
  save(draft: MMPlayDraft): void {
    try {
      const json = JSON.stringify(draft);
      localStorage.setItem(MM_PLAY_DRAFT_KEY, json);
    } catch (error) {
      console.error('[MMPlayDraftManager] 保存草稿失败', error);
    }
  }

  /**
   * 加载草稿
   */
  load(): MMPlayDraft | null {
    try {
      const json = localStorage.getItem(MM_PLAY_DRAFT_KEY);
      if (!json) {
        return null;
      }
      const draft = JSON.parse(json) as MMPlayDraft;
      return draft;
    } catch (error) {
      console.error('[MMPlayDraftManager] 加载草稿失败', error);
      return null;
    }
  }

  /**
   * 清除草稿
   */
  clear(): void {
    try {
      localStorage.removeItem(MM_PLAY_DRAFT_KEY);
    } catch (error) {
      console.error('[MMPlayDraftManager] 清除草稿失败', error);
    }
  }
}
