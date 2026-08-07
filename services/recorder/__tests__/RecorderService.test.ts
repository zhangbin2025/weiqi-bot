/**
 * @fileoverview RecorderService 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecorderService } from '../RecorderService';
import type { IKeyValueStorage } from '../../../infrastructure/storage/interfaces';
import type { IDraft } from '../types';

/** 创建 Mock IKeyValueStorage */
function createMockStorage(): IKeyValueStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    read: vi.fn(async <T>(key: string): Promise<T | null> => {
      return (data.get(key) as T) ?? null;
    }),
    write: vi.fn(async <T>(key: string, value: T): Promise<void> => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      data.delete(key);
    }),
    exists: vi.fn(async (key: string): Promise<boolean> => {
      return data.has(key);
    }),
    listKeys: vi.fn(async (pattern?: string): Promise<string[]> => {
      if (!pattern) return [...data.keys()];
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return [...data.keys()].filter((k) => regex.test(k));
    }),
    clear: vi.fn(async (): Promise<void> => {
      data.clear();
    }),
  };
}

describe('RecorderService', () => {
  let service: RecorderService;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
    service = new RecorderService(storage);
  });

  afterEach(() => {
    // disableAutoSave 已移除，不再需要清理
  });

  describe('游戏管理', () => {
    it('应该成功落子', () => {
      const result = service.placeStone(3, 3);
      expect(result.success).toBe(true);
      expect(result.captured).toEqual([]);
    });

    it('应该在已有棋子的位置落子失败', () => {
      service.placeStone(3, 3);
      const result = service.placeStone(3, 3);
      expect(result.success).toBe(false);
      expect(result.error).toBe('该位置已有棋子');
    });

    it('应该成功停一手', () => {
      const state1 = service.getState();
      expect(state1.currentPlayer).toBe('black');

      service.pass();
      const state2 = service.getState();
      expect(state2.currentPlayer).toBe('white');
    });

    it('应该成功悔棋', () => {
      service.placeStone(3, 3);
      const state1 = service.getState();
      expect(state1.moveHistory.length).toBe(1);

      const result = service.undo();
      expect(result).toBe(true);

      const state2 = service.getState();
      expect(state2.moveHistory.length).toBe(0);
    });

    it('应该成功新建对局', () => {
      service.placeStone(3, 3);
      service.placeStone(15, 15);

      service.newGame({ size: 9, komi: 6.5 });
      const state = service.getState();

      expect(state.moveHistory.length).toBe(0);
      expect(state.board.size).toBe(9);
      expect(state.komi).toBe(6.5);
    });
  });

  describe('SGF 生成', () => {
    it('应该生成有效的 SGF', () => {
      service.placeStone(3, 3);
      service.placeStone(15, 15);

      const sgf = service.generateSGF({
        blackName: '测试黑方',
        whiteName: '测试白方',
      });

      expect(sgf).toContain('GM[1]');
      expect(sgf).toContain('SZ[19]');
      expect(sgf).toContain('PB[测试黑方]');
      expect(sgf).toContain('PW[测试白方]');
      expect(sgf).toContain('B[dd]');
      expect(sgf).toContain('W[pp]');
    });

    it('应该处理停一手', () => {
      service.placeStone(3, 3);
      service.pass();

      const sgf = service.generateSGF();
      expect(sgf).toContain('B[dd]');
      expect(sgf).toContain('W[tt]');
    });
  });

  describe('草稿管理', () => {
    it('应该成功保存草稿', async () => {
      service.placeStone(3, 3);
      service.placeStone(15, 15);

      await service.saveDraft();
      expect(storage.write).toHaveBeenCalledWith('recorder:draft', expect.any(Object));

      const draft = storage.data.get('recorder:draft') as IDraft;
      expect(draft.sgf).toContain('B[dd]');
      expect(draft.sgf).toContain('W[pp]');
      expect(draft.state.moveHistory.length).toBe(2);
    });

    it('应该成功加载草稿', async () => {
      service.placeStone(3, 3);
      service.placeStone(15, 15);
      await service.saveDraft();

      // 新建服务实例加载草稿
      const service2 = new RecorderService(storage);
      await service2.loadDraft();

      const state = service2.getState();
      expect(state.moveHistory.length).toBe(2);
    });

    it('加载空草稿不应该报错', async () => {
      await expect(service.loadDraft()).resolves.toBeUndefined();
    });

    it('应该成功清除草稿', async () => {
      service.placeStone(3, 3);
      await service.saveDraft();

      await service.clearDraft();
      expect(storage.data.has('recorder:draft')).toBe(false);
    });
  });

  describe('onUpdate 回调', () => {
    it('应该在落子后调用 onUpdate 回调', () => {
      const callback = vi.fn();
      service.setOnUpdate(callback);

      service.placeStone(3, 3);

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        moveHistory: expect.arrayContaining([expect.objectContaining({ x: 3, y: 3 })]),
      }));
    });

    it('应该在撤销后调用 onUpdate 回调', () => {
      service.placeStone(3, 3);

      const callback = vi.fn();
      service.setOnUpdate(callback);

      service.undo();

      expect(callback).toHaveBeenCalled();
    });

    it('应该在停一手后调用 onUpdate 回调', () => {
      const callback = vi.fn();
      service.setOnUpdate(callback);

      service.pass();

      expect(callback).toHaveBeenCalled();
    });
  });
});
