import * as fs from 'fs';
import * as path from 'path';
import { NodeFileAdapter } from '../NodeFileAdapter';

describe('NodeFileAdapter - Directory Operations', () => {
  let storage: NodeFileAdapter;
  const testDir = './test-file-storage';

  beforeEach(async () => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    storage = new NodeFileAdapter(testDir);
    await storage.initialize();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      const blob1 = new Blob(['test1'], { type: 'text/plain' });
      const blob2 = new Blob(['test2'], { type: 'text/plain' });

      await storage.upload('data/file1.txt', blob1);
      await storage.upload('data/file2.txt', blob2);

      const files = await storage.listFiles('data');

      expect(files).toContain('data/file1.txt');
      expect(files).toContain('data/file2.txt');
    });

    it('should return empty array for non-existent directory', async () => {
      const files = await storage.listFiles('non-existent');
      expect(files).toHaveLength(0);
    });
  });

  describe('createDirectory', () => {
    it('should create directory', async () => {
      await storage.createDirectory('data/models');

      const fullPath = path.join(testDir, 'data', 'models');
      expect(fs.existsSync(fullPath)).toBe(true);
    });

    it('should not throw error when directory exists', async () => {
      await storage.createDirectory('data');
      await expect(storage.createDirectory('data')).resolves.not.toThrow();
    });
  });

  describe('deleteDirectory', () => {
    it('should delete empty directory', async () => {
      await storage.createDirectory('data');
      await storage.deleteDirectory('data');

      const fullPath = path.join(testDir, 'data');
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it('should delete directory recursively', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      await storage.upload('data/file.txt', blob);
      await storage.deleteDirectory('data', true);

      expect(await storage.exists('data/file.txt')).toBe(false);
    });
  });
});