import * as fs from 'fs';
import * as path from 'path';
import { JsonFileAdapter } from '../JsonFileAdapter';

describe('JsonFileAdapter - Document Storage', () => {
  let storage: JsonFileAdapter;
  const testDir = './test-storage';
  const testFile = path.join(testDir, 'test-data.json');

  beforeEach(async () => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    storage = new JsonFileAdapter(testFile);
    await storage.initialize();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('insert', () => {
    it('should insert document', async () => {
      const id = await storage.insert({ id: '1', name: 'Alice', age: 25 });

      expect(id).toBe('1');
      const doc = await storage.findById('1');
      expect(doc?.name).toBe('Alice');
    });
  });

  describe('insertMany', () => {
    it('should insert multiple documents', async () => {
      const ids = await storage.insertMany([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);

      expect(ids).toEqual(['1', '2']);
      expect(await storage.count()).toBe(2);
    });
  });

  describe('update', () => {
    it('should update document', async () => {
      await storage.insert({ id: '1', name: 'Alice', age: 25 });
      await storage.update('1', { age: 26 });

      const doc = await storage.findById('1');
      expect(doc?.age).toBe(26);
      expect(doc?.name).toBe('Alice');
    });

    it('should throw error when updating non-existent document', async () => {
      await expect(storage.update('999', { age: 30 })).rejects.toThrow(
        'Document with id "999" not found'
      );
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await storage.insertMany([
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
        { id: '3', name: 'Charlie', age: 25 },
      ]);
    });

    it('should find all documents', async () => {
      const docs = await storage.find();
      expect(docs).toHaveLength(3);
    });

    it('should find with where condition', async () => {
      const docs = await storage.find({ where: { age: 25 } });
      expect(docs).toHaveLength(2);
    });

    it('should find with ordering', async () => {
      const docs = await storage.find({
        orderBy: 'age',
        orderDirection: 'desc',
      });
      expect(docs[0].age).toBe(30);
    });

    it('should find with pagination', async () => {
      const docs = await storage.find({ limit: 2 });
      expect(docs).toHaveLength(2);
    });
  });
});