import * as fs from 'fs';
import { NodeFileAdapter } from '../NodeFileAdapter';
import { FileAdapterType } from '../../../interfaces/IFileStorage';

describe('NodeFileAdapter - File Operations', () => {
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

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const newDir = './new-storage-init';
      const newStorage = new NodeFileAdapter(newDir);
      await expect(newStorage.initialize()).resolves.not.toThrow();
      // 清理
      if (fs.existsSync(newDir)) {
        fs.rmSync(newDir, { recursive: true, force: true });
      }
    });

    it('should create directory if not exists', async () => {
      const newDir = './new-storage-' + Date.now();
      const newStorage = new NodeFileAdapter(newDir);

      await newStorage.initialize();

      expect(fs.existsSync(newDir)).toBe(true);

      // 清理
      if (fs.existsSync(newDir)) {
        fs.rmSync(newDir, { recursive: true, force: true });
      }
    });
  });

  describe('upload and download', () => {
    it('should upload and download file with ArrayBuffer', async () => {
      const content = 'Hello, World!';
      const buffer = new TextEncoder().encode(content).buffer;

      await storage.upload('test.txt', buffer);
      const downloaded = await storage.download('test.txt');
      const text = await downloaded.text();

      expect(text).toBe(content);
    });

    it('should upload and download file with Blob', async () => {
      const content = 'Test data';
      const blob = new Blob([content], { type: 'text/plain' });

      await storage.upload('test.txt', blob);
      const downloaded = await storage.download('test.txt');
      const text = await downloaded.text();

      expect(text).toBe(content);
    });

    it('should throw error when downloading non-existent file', async () => {
      await expect(storage.download('non-existent.txt')).rejects.toThrow(
        'File not found: non-existent.txt'
      );
    });
  });

  describe('delete', () => {
    it('should delete file', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      await storage.upload('test.txt', blob);
      await storage.delete('test.txt');

      expect(await storage.exists('test.txt')).toBe(false);
    });

    it('should not throw error when deleting non-existent file', async () => {
      await expect(storage.delete('non-existent.txt')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      await storage.upload('test.txt', blob);

      expect(await storage.exists('test.txt')).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      expect(await storage.exists('non-existent.txt')).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      const content = 'Test content';
      const blob = new Blob([content], { type: 'text/plain' });
      await storage.upload('test.txt', blob);

      const meta = await storage.getMetadata('test.txt');

      expect(meta.path).toBe('test.txt');
      expect(meta.size).toBe(content.length);
      expect(meta.contentType).toBe('text/plain');
      expect(meta.lastModified).toBeInstanceOf(Date);
    });

    it('should throw error for non-existent file', async () => {
      await expect(storage.getMetadata('non-existent.txt')).rejects.toThrow(
        'File not found: non-existent.txt'
      );
    });
  });

  describe('readChunk', () => {
    it('should read file chunk', async () => {
      const content = 'Hello, World!';
      const blob = new Blob([content], { type: 'text/plain' });
      await storage.upload('test.txt', blob);

      const chunk = await storage.readChunk('test.txt', 0, 5);
      const text = new TextDecoder().decode(chunk);

      expect(text).toBe('Hello');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        storage.readChunk('non-existent.txt', 0, 5)
      ).rejects.toThrow('File not found: non-existent.txt');
    });
  });

  describe('adapter properties', () => {
    it('should have correct name', () => {
      expect(storage.name).toBe(`nodeFS:${testDir}`);
    });

    it('should have correct type', () => {
      expect(storage.type).toBe(FileAdapterType.NodeFS);
    });
  });
});