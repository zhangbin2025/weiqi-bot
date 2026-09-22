/**
 * AI自对弈草稿管理器
 */

import type { MMPlayDraft } from './MMPlayDraftTypes';
import { MM_PLAY_DRAFT_KEY } from './MMPlayDraftTypes';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

/**
 * AI自对弈草稿管理器
 */
export class MMPlayDraftManager {
  private readonly storage = new LocalStorageAdapter('weiqi-mm-play');

  /**
   * 保存草稿
   */
  async save(draft: MMPlayDraft): Promise<void> {
    try {
      await this.storage.initialize();
      await this.storage.write(MM_PLAY_DRAFT_KEY, draft);
    } catch (error) {
      console.error('[MMPlayDraftManager] 保存草稿失败', error);
    }
  }

  /**
   * 加载草稿
   */
  async load(): Promise<MMPlayDraft | null> {
    try {
      await this.storage.initialize();
      return await this.storage.read<MMPlayDraft>(MM_PLAY_DRAFT_KEY);
    } catch (error) {
      console.error('[MMPlayDraftManager] 加载草稿失败', error);
      return null;
    }
  }

  /**
   * 清除草稿
   */
  async clear(): Promise<void> {
    try {
      await this.storage.initialize();
      await this.storage.delete(MM_PLAY_DRAFT_KEY);
    } catch (error) {
      console.error('[MMPlayDraftManager] 清除草稿失败', error);
    }
  }
}
