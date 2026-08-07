/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { IndexedDBAdapter } from '../IndexedDBAdapter';

interface TestDocument {
  id: string;
  name: string;
  age: number;
  email?: string;
}

describe('IndexedDBAdapter - Query Operations', () => {
  let adapter: IndexedDBAdapter<TestDocument>;

  beforeEach(async () => {
    adapter = new IndexedDBAdapter<TestDocument>('test-db', 'test-store');
    await adapter.initialize();
  });

  afterEach(async () => {
    try {
      await adapter.clear();
      await adapter.destroy();
    } catch {
      // ignore cleanup errors
    }
  });

  describe('findById', () => {
    it('should find a document by id', async () => {
      const doc: TestDocument = { id: '1', name: 'Alice', age: 25 };
      await adapter.insert(doc);

      const found = await adapter.findById('1');
      expect(found).toEqual(doc);
    });

    it('should return null for non-existent id', async () => {
      const found = await adapter.findById('999');
      expect(found).toBeNull();
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await adapter.insertMany([
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
        { id: '3', name: 'Charlie', age: 25 },
      ]);
    });

    it('should find all documents without criteria', async () => {
      const docs = await adapter.find();
      expect(docs.length).toBe(3);
    });

    it('should find documents with where condition', async () => {
      const docs = await adapter.find({ where: { age: 25 } });
      expect(docs.length).toBe(2);
      expect(docs.every((d) => d.age === 25)).toBe(true);
    });

    it('should find documents with ordering', async () => {
      const docs = await adapter.find({
        orderBy: 'age',
        orderDirection: 'desc',
      });

      expect(docs[0].age).toBe(30);
      expect(docs[2].age).toBe(25);
    });

    it('should find documents with pagination', async () => {
      const docs = await adapter.find({ limit: 2 });
      expect(docs.length).toBe(2);
    });

    it('should find documents with offset', async () => {
      const docs = await adapter.find({ orderBy: 'name', offset: 1 });
      expect(docs.length).toBe(2);
      expect(docs[0].name).toBe('Bob');
    });
  });

  describe('findOne', () => {
    it('should find one document', async () => {
      await adapter.insert({ id: '1', name: 'Alice', age: 25 });

      const doc = await adapter.findOne({ where: { name: 'Alice' } });
      expect(doc?.name).toBe('Alice');
    });

    it('should return null when no document found', async () => {
      const doc = await adapter.findOne({ where: { name: 'NonExistent' } });
      expect(doc).toBeNull();
    });
  });
});
