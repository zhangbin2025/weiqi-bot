import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReadMarkService } from '../ReadMarkService';
import { READ_MARK_CATEGORIES } from '../types';
import type { IKeyValueStorage } from '../../../infrastructure/storage/interfaces';

describe('ReadMarkService', () => {
  let service: ReadMarkService;
  let mockStorage: IKeyValueStorage;

  beforeEach(() => {
    mockStorage = {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      listKeys: vi.fn(),
      clear: vi.fn(),
    };
    service = new ReadMarkService(mockStorage);
  });

  describe('markRead', () => {
    it('应该标记已读', async () => {
      mockStorage.read.mockResolvedValueOnce(null);
      
      await service.markRead(READ_MARK_CATEGORIES.OPPONENT_GAMES, 'game-1');
      
      expect(mockStorage.write).toHaveBeenCalled();
    });

    it('重复标记不应重复添加', async () => {
      mockStorage.read.mockResolvedValueOnce({ ids: ['game-1'], updatedAt: 1000 });
      
      await service.markRead(READ_MARK_CATEGORIES.OPPONENT_GAMES, 'game-1');
      
      expect(mockStorage.write).not.toHaveBeenCalled();
    });
  });

  describe('markReadBatch', () => {
    it('应该批量标记已读', async () => {
      mockStorage.read.mockResolvedValueOnce({ ids: [], updatedAt: 0 });
      
      await service.markReadBatch(READ_MARK_CATEGORIES.OPPONENT_GAMES, ['game-1', 'game-2']);
      
      expect(mockStorage.write).toHaveBeenCalledWith(
        'readmark:opponent:games',
        expect.objectContaining({ ids: ['game-1', 'game-2'] })
      );
    });

    it('已存在的ID不应重复添加', async () => {
      mockStorage.read.mockResolvedValueOnce({ ids: ['game-1'], updatedAt: 1000 });
      
      await service.markReadBatch(READ_MARK_CATEGORIES.OPPONENT_GAMES, ['game-1', 'game-2']);
      
      expect(mockStorage.write).toHaveBeenCalledWith(
        'readmark:opponent:games',
        expect.objectContaining({ ids: ['game-1', 'game-2'] })
      );
    });
  });

  describe('isRead', () => {
    it('已读应返回 true', async () => {
      mockStorage.read.mockResolvedValueOnce({ ids: ['game-1'], updatedAt: 1000 });
      
      const result = await service.isRead(READ_MARK_CATEGORIES.OPPONENT_GAMES, 'game-1');
      
      expect(result).toBe(true);
    });

    it('未读应返回 false', async () => {
      mockStorage.read.mockResolvedValueOnce({ ids: [], updatedAt: 0 });
      
      const result = await service.isRead(READ_MARK_CATEGORIES.OPPONENT_GAMES, 'game-1');
      
      expect(result).toBe(false);
    });
  });

  describe('getReadMarks', () => {
    it('应该返回已读ID列表', async () => {
      mockStorage.read.mockResolvedValueOnce({ ids: ['game-1', 'game-2'], updatedAt: 1000 });
      
      const result = await service.getReadMarks(READ_MARK_CATEGORIES.OPPONENT_GAMES);
      
      expect(result).toEqual(['game-1', 'game-2']);
    });

    it('无数据应返回空数组', async () => {
      mockStorage.read.mockResolvedValueOnce(null);
      
      const result = await service.getReadMarks(READ_MARK_CATEGORIES.OPPONENT_GAMES);
      
      expect(result).toEqual([]);
    });
  });

  describe('clearReadMarks', () => {
    it('应该清除所有已读标记', async () => {
      await service.clearReadMarks(READ_MARK_CATEGORIES.OPPONENT_GAMES);
      
      expect(mockStorage.delete).toHaveBeenCalledWith('readmark:opponent:games');
    });
  });
});
