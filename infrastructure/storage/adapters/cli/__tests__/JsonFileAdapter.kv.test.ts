import * as fs from 'fs';
import * as path from 'path';
import { JsonFileAdapter } from '../JsonFileAdapter';
import { StorageAdapterType } from '../../../interfaces/IKeyValueStorage';

describe('JsonFileAdapter - Key-Value Storage', () => {
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

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const newStorage = new JsonFileAdapter(path.join(testDir, 'new.json'));
      await expect(newStorage.initialize()).resolves.not.toThrow();
    });

    it('should create directory if not exists', async () => {
      const newDir = path.join(testDir, 'deep', 'nested');
      const newFile = path.join(newDir, 'data.json');
      const newStorage = new JsonFileAdapter(newFile);

      await newStorage.initialize();

      expect(fs.existsSync(newDir)).toBe(true);
    });

    it('should load existing data', async () => {
      await storage.write('key1', 'value1');
      await storage.destroy();

      const newStorage = new JsonFileAdapter(testFile);
      await newStorage.initialize();

      const value = await newStorage.read('key1');
      expect(value).toBe('value1');
    });
  });

  describe('read and write', () => {
    it('should write and read data', async () => {
      await storage.write('key1', { name: 'Alice' });
      const data = await storage.read<{ name: string }>('key1');

      expect(data).toEqual({ name: 'Alice' });
    });

    it('should return null for non-existent key', async () => {
      const data = await storage.read('non-existent');
      expect(data).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete data', async () => {
      await storage.write('key1', 'value1');
      await storage.delete('key1');

      expect(await storage.exists('key1')).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await storage.write('key1', 'value1');
      expect(await storage.exists('key1')).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      expect(await storage.exists('non-existent')).toBe(false);
    });
  });

  describe('listKeys', () => {
    it('should list all keys', async () => {
      await storage.write('key1', 'value1');
      await storage.write('key2', 'value2');

      const keys = await storage.listKeys();

      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should list keys with pattern', async () => {
      await storage.write('user-1', 'value1');
      await storage.write('user-2', 'value2');
      await storage.write('admin-1', 'value3');

      const keys = await storage.listKeys('user-*');

      expect(keys).toContain('user-1');
      expect(keys).toContain('user-2');
      expect(keys).not.toContain('admin-1');
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      await storage.write('key1', 'value1');
      await storage.write('key2', 'value2');
      await storage.clear();

      expect(await storage.listKeys()).toHaveLength(0);
    });
  });

  describe('adapter properties', () => {
    it('should have correct name', () => {
      expect(storage.name).toBe(`jsonFile:${testFile}`);
    });

    it('should have correct type', () => {
      expect(storage.type).toBe(StorageAdapterType.JsonFile);
    });
  });
});