/**
 * 人机对弈草稿管理器
 */

import type { HMPlayDraft } from './HMPlayDraftTypes';
import { HM_PLAY_DRAFT_KEY } from './HMPlayDraftTypes';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

/**
 * 人机对弈草稿管理器
 */
export class HMPlayDraftManager {
  private readonly storage = new LocalStorageAdapter('weiqi-hm-play');

  /**
   * 保存草稿
   */
  async save(draft: HMPlayDraft): Promise<void> {
    try {
      await this.storage.initialize();
      await this.storage.write(HM_PLAY_DRAFT_KEY, draft);
    } catch (error) {
      console.error('[HMPlayDraftManager] 保存草稿失败', error);
    }
  }

  /**
   * 加载草稿
   */
  async load(): Promise<HMPlayDraft | null> {
    try {
      await this.storage.initialize();
      return await this.storage.read<HMPlayDraft>(HM_PLAY_DRAFT_KEY);
    } catch (error) {
      console.error('[HMPlayDraftManager] 加载草稿失败', error);
      return null;
    }
  }

  /**
   * 清除草稿
   */
  async clear(): Promise<void> {
    try {
      await this.storage.initialize();
      await this.storage.delete(HM_PLAY_DRAFT_KEY);
    } catch (error) {
      console.error('[HMPlayDraftManager] 清除草稿失败', error);
    }
  }
}
