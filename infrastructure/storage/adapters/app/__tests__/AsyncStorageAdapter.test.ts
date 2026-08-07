/**
 * @fileoverview AsyncStorageAdapter 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncStorageAdapter } from '../AsyncStorageAdapter';

// Mock AsyncStorage
const mockStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      mockStore.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      mockStore.delete(key);
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      mockStore.clear();
      return Promise.resolve();
    }),
  },
}));

interface TestDoc {
  id: string;
  name: string;
  value: number;
}

describe('AsyncStorageAdapter', () => {
  let adapter: AsyncStorageAdapter<TestDoc>;

  beforeEach(() => {
    mockStore.clear();
    adapter = new AsyncStorageAdapter<TestDoc>('test-docs');
  });

  describe('initialize', () => {
    it('应成功初始化', async () => {
      await expect(adapter.initialize()).resolves.toBeUndefined();
    });

    it('重复初始化不应报错', async () => {
      await adapter.initialize();
      await expect(adapter.initialize()).resolves.toBeUndefined();
    });
  });

  describe('insert', () => {
    it('应插入文档并返回 id', async () => {
      const id = await adapter.insert({ id: '1', name: 'test', value: 10 });
      expect(id).toBe('1');
    });

    it('重复插入相同 id 应抛出错误', async () => {
      await adapter.insert({ id: '1', name: 'test', value: 10 });
      await expect(
        adapter.insert({ id: '1', name: 'dup', value: 20 }),
      ).rejects.toThrow('already exists');
    });
  });

  describe('insertMany', () => {
    it('应批量插入文档', async () => {
      const ids = await adapter.insertMany([
        { id: '1', name: 'a', value: 1 },
        { id: '2', name: 'b', value: 2 },
      ]);
      expect(ids).toEqual(['1', '2']);
    });

    it('批量插入中有重复 id 应抛出错误', async () => {
      await adapter.insert({ id: '1', name: 'a', value: 1 });
      await expect(
        adapter.insertMany([{ id: '1', name: 'dup', value: 2 }]),
      ).rejects.toThrow('already exists');
    });
  });

  describe('findById', () => {
    it('应按 id 查找文档', async () => {
      await adapter.insert({ id: '1', name: 'test', value: 10 });
      const doc = await adapter.findById('1');
      expect(doc).toEqual({ id: '1', name: 'test', value: 10 });
    });

    it('找不到应返回 null', async () => {
      const doc = await adapter.findById('not-exist');
      expect(doc).toBeNull();
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await adapter.insertMany([
        { id: '1', name: 'alice', value: 10 },
        { id: '2', name: 'bob', value: 20 },
        { id: '3', name: 'alice', value: 30 },
      ]);
    });

    it('无条件应返回所有文档', async () => {
      const docs = await adapter.find();
      expect(docs).toHaveLength(3);
    });

    it('应支持 where 条件过滤', async () => {
      const docs = await adapter.find({ where: { name: 'alice' } });
      expect(docs).toHaveLength(2);
    });

    it('应支持 orderBy 升序排序', async () => {
      const docs = await adapter.find({ orderBy: 'value', orderDirection: 'asc' });
      expect(docs.map(d => d.value)).toEqual([10, 20, 30]);
    });

    it('应支持 orderBy 降序排序', async () => {
      const docs = await adapter.find({ orderBy: 'value', orderDirection: 'desc' });
      expect(docs.map(d => d.value)).toEqual([30, 20, 10]);
    });

    it('应支持 limit 分页', async () => {
      const docs = await adapter.find({ limit: 2 });
      expect(docs).toHaveLength(2);
    });

    it('应支持 offset 偏移', async () => {
      const docs = await adapter.find({ offset: 1 });
      expect(docs).toHaveLength(2);
    });

    it('应支持组合条件', async () => {
      const docs = await adapter.find({
        where: { name: 'alice' },
        orderBy: 'value',
        orderDirection: 'desc',
        limit: 1,
      });
      expect(docs).toHaveLength(1);
      expect(docs[0].value).toBe(30);
    });
  });

  describe('findOne', () => {
    it('应返回第一条匹配文档', async () => {
      await adapter.insertMany([
        { id: '1', name: 'a', value: 1 },
        { id: '2', name: 'a', value: 2 },
      ]);
      const doc = await adapter.findOne({ where: { name: 'a' } });
      expect(doc).not.toBeNull();
      expect(doc!.id).toBe('1');
    });

    it('无匹配应返回 null', async () => {
      const doc = await adapter.findOne({ where: { name: 'none' } });
      expect(doc).toBeNull();
    });
  });

  describe('update', () => {
    it('应更新文档字段', async () => {
      await adapter.insert({ id: '1', name: 'old', value: 10 });
      await adapter.update('1', { name: 'new' });
      const doc = await adapter.findById('1');
      expect(doc).toEqual({ id: '1', name: 'new', value: 10 });
    });

    it('更新不存在的 id 应抛出错误', async () => {
      await expect(adapter.update('not-exist', { name: 'x' })).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('delete', () => {
    it('应删除文档', async () => {
      await adapter.insert({ id: '1', name: 'test', value: 10 });
      await adapter.delete('1');
      const doc = await adapter.findById('1');
      expect(doc).toBeNull();
    });
  });

  describe('deleteMany', () => {
    it('应批量删除文档', async () => {
      await adapter.insertMany([
        { id: '1', name: 'a', value: 1 },
        { id: '2', name: 'b', value: 2 },
        { id: '3', name: 'c', value: 3 },
      ]);
      await adapter.deleteMany(['1', '3']);
      const docs = await adapter.find();
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('2');
    });
  });

  describe('count', () => {
    it('应返回文档总数', async () => {
      await adapter.insertMany([
        { id: '1', name: 'a', value: 1 },
        { id: '2', name: 'b', value: 2 },
      ]);
      const count = await adapter.count();
      expect(count).toBe(2);
    });

    it('应支持条件计数', async () => {
      await adapter.insertMany([
        { id: '1', name: 'a', value: 1 },
        { id: '2', name: 'b', value: 2 },
      ]);
      const count = await adapter.count({ where: { name: 'a' } });
      expect(count).toBe(1);
    });
  });

  describe('exists', () => {
    it('存在应返回 true', async () => {
      await adapter.insert({ id: '1', name: 'test', value: 10 });
      await expect(adapter.exists('1')).resolves.toBe(true);
    });

    it('不存在应返回 false', async () => {
      await expect(adapter.exists('not-exist')).resolves.toBe(false);
    });
  });

  describe('clear', () => {
    it('应清空所有文档', async () => {
      await adapter.insertMany([
        { id: '1', name: 'a', value: 1 },
        { id: '2', name: 'b', value: 2 },
      ]);
      await adapter.clear();
      const count = await adapter.count();
      expect(count).toBe(0);
    });
  });

  describe('数据持久化', () => {
    it('新实例应能读取已存储的数据', async () => {
      await adapter.insert({ id: '1', name: 'persist', value: 42 });
      const adapter2 = new AsyncStorageAdapter<TestDoc>('test-docs');
      const doc = await adapter2.findById('1');
      expect(doc).toEqual({ id: '1', name: 'persist', value: 42 });
    });
  });

  describe('异常处理', () => {
    it('损坏的 JSON 数据应返回空数组', async () => {
      mockStore.set('bad-data', 'not-valid-json{');
      const badAdapter = new AsyncStorageAdapter<TestDoc>('bad-data');
      const docs = await badAdapter.find();
      expect(docs).toEqual([]);
    });
  });
});
