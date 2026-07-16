/**
 * @fileoverview 真人对弈草稿管理器
 * @description 负责对局状态的持久化保存和恢复
 */

import type { IKeyValueStorage } from '../../../infrastructure/storage/interfaces/IKeyValueStorage';
import type { HHPlayDraft } from './DraftTypes';
import { DRAFT_KEY } from './DraftTypes';

/**
 * 草稿管理器
 * @description 管理对局状态的保存、加载和清除
 */
export class DraftManager {
  constructor(private readonly storage: IKeyValueStorage) {}

  /**
   * 保存草稿
   * @param draft - 草稿数据
   */
  async save(draft: HHPlayDraft): Promise<void> {
    await this.storage.write(DRAFT_KEY, draft);
  }

  /**
   * 加载草稿
   * @returns 草稿数据，不存在返回 null
   */
  async load(): Promise<HHPlayDraft | null> {
    return await this.storage.read<HHPlayDraft>(DRAFT_KEY);
  }

  /**
   * 清除草稿
   */
  async clear(): Promise<void> {
    await this.storage.delete(DRAFT_KEY);
  }

  /**
   * 检查是否存在有效草稿
   * @returns 是否存在未完成的对局
   */
  async hasValidDraft(): Promise<boolean> {
    const draft = await this.load();
    return draft !== null && draft.inGame && !draft.gameEnded;
  }
}
