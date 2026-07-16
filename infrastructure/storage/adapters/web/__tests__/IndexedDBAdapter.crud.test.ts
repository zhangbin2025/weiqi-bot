/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { IndexedDBAdapter } from '../IndexedDBAdapter';
import { StorageAdapterType } from '../../../interfaces/IDocumentStorage';

interface TestDocument {
  id: string;
  name: string;
  age: number;
  email?: string;
}

describe('IndexedDBAdapter - CRUD Operations', () => {
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

  describe('initialize', () => {
    it('should initialize successfully when IndexedDB is available', async () => {
      const newAdapter = new IndexedDBAdapter<TestDocument>(
        'new-db',
        'new-store'
      );
      await expect(newAdapter.initialize()).resolves.not.toThrow();
      await newAdapter.destroy();
    });
  });

  describe('isAvailable', () => {
    it('should return true when IndexedDB is available', () => {
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  describe('insert', () => {
    it('should insert a document', async () => {
      const doc: TestDocument = { id: '1', name: 'Alice', age: 25 };
      const id = await adapter.insert(doc);

      expect(id).toBe('1');

      const found = await adapter.findById('1');
      expect(found).toEqual(doc);
    });
  });

  describe('insertMany', () => {
    it('should insert multiple documents', async () => {
      const docs: TestDocument[] = [
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
      ];

      const ids = await adapter.insertMany(docs);

      expect(ids).toEqual(['1', '2']);
      expect(await adapter.count()).toBe(2);
    });
  });

  describe('update', () => {
    it('should update an existing document', async () => {
      await adapter.insert({ id: '1', name: 'Alice', age: 25 });
      await adapter.update('1', { age: 26 });

      const doc = await adapter.findById('1');
      expect(doc?.age).toBe(26);
      expect(doc?.name).toBe('Alice');
    });

    it('should throw error when updating non-existent document', async () => {
      await expect(adapter.update('999', { age: 30 })).rejects.toThrow(
        'Document with id "999" not found'
      );
    });
  });

  describe('delete', () => {
    it('should delete an existing document', async () => {
      await adapter.insert({ id: '1', name: 'Alice', age: 25 });
      await adapter.delete('1');

      const doc = await adapter.findById('1');
      expect(doc).toBeNull();
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple documents', async () => {
      await adapter.insertMany([
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
      ]);

      await adapter.deleteMany(['1', '2']);

      expect(await adapter.count()).toBe(0);
    });
  });

  describe('count', () => {
    it('should count all documents', async () => {
      await adapter.insertMany([
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
      ]);

      const count = await adapter.count();
      expect(count).toBe(2);
    });

    it('should count documents with criteria', async () => {
      await adapter.insertMany([
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
        { id: '3', name: 'Charlie', age: 25 },
      ]);

      const count = await adapter.count({ where: { age: 25 } });
      expect(count).toBe(2);
    });
  });

  describe('exists', () => {
    it('should return true for existing document', async () => {
      await adapter.insert({ id: '1', name: 'Alice', age: 25 });

      expect(await adapter.exists('1')).toBe(true);
    });

    it('should return false for non-existent document', async () => {
      expect(await adapter.exists('999')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all documents', async () => {
      await adapter.insertMany([
        { id: '1', name: 'Alice', age: 25 },
        { id: '2', name: 'Bob', age: 30 },
      ]);

      await adapter.clear();
      expect(await adapter.count()).toBe(0);
    });
  });

  describe('adapter properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('indexedDB:test-db:test-store');
    });

    it('should have correct type', () => {
      expect(adapter.type).toBe(StorageAdapterType.IndexedDB);
    });
  });
});
