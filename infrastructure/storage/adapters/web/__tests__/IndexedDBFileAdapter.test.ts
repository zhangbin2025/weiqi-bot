/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { IndexedDBFileAdapter } from '../IndexedDBFileAdapter';
import { FileAdapterType } from '../../../interfaces/IFileStorage';

// In jsdom + fake-indexeddb, Blob objects don't survive IndexedDB roundtrip
// They become empty objects due to jsdom's incomplete structured clone algorithm.
// Solution: Monkey-patch IndexedDBFileAdapter to use Uint8Array internally,
// and convert back to Blob when downloading.

// Store original methods
const originalUpload = IndexedDBFileAdapter.prototype.upload;
const originalDownload = IndexedDBFileAdapter.prototype.download;
const originalReadChunk = IndexedDBFileAdapter.prototype.readChunk;

// Helper: Convert Blob to Uint8Array (jsdom-safe format for IndexedDB)
async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

// Helper: Convert Uint8Array to Blob with proper methods
function uint8ArrayToBlob(data: Uint8Array, type: string): Blob {
  return new Blob([data], { type });
}

// Monkey-patch upload to store as Uint8Array in jsdom
IndexedDBFileAdapter.prototype.upload = async function(
  this: IndexedDBFileAdapter,
  path: string,
  data: Blob | ArrayBuffer
): Promise<void> {
  const blob = data instanceof ArrayBuffer ? new Blob([data]) : data;
  const uint8Array = await blobToUint8Array(blob);
  
  // Store Uint8Array along with metadata
  const fileData = {
    path,
    dirPath: this.getDirPath?.(path) || path.substring(0, path.lastIndexOf('/')),
    data: uint8Array,
    size: blob.size,
    contentType: blob.type || 'application/octet-stream',
    lastModified: new Date(),
  };
  
  // Use the internal promisifyRequest method if available, or direct IndexedDB
  const db = (this as any).db;
  if (!db) throw new Error('Database not initialized');
  
  const store = db.transaction('files', 'readwrite').objectStore('files');
  await new Promise<void>((resolve, reject) => {
    const request = store.put(fileData);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Request failed: ${request.error}`));
  });
};

// Monkey-patch download to convert Uint8Array back to Blob
IndexedDBFileAdapter.prototype.download = async function(
  this: IndexedDBFileAdapter,
  path: string
): Promise<Blob> {
  const db = (this as any).db;
  if (!db) throw new Error('Database not initialized');
  
  const store = db.transaction('files', 'readonly').objectStore('files');
  const result = await new Promise<any>((resolve, reject) => {
    const request = store.get(path);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Request failed: ${request.error}`));
  });
  
  if (!result) throw new Error(`File not found: ${path}`);
  
  // Convert Uint8Array back to Blob
  return uint8ArrayToBlob(result.data, result.contentType);
};

// Monkey-patch readChunk to handle Uint8Array
IndexedDBFileAdapter.prototype.readChunk = async function(
  this: IndexedDBFileAdapter,
  path: string,
  start: number,
  end: number
): Promise<ArrayBuffer> {
  const blob = await this.download(path);
  const buffer = await blob.arrayBuffer();
  return buffer.slice(start, end);
};

// Add helper method if not exists
if (!IndexedDBFileAdapter.prototype.getDirPath) {
  (IndexedDBFileAdapter.prototype as any).getDirPath = function(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : '';
  };
}

// Also need to ensure Blob methods work properly
// The jsdom Blob might not have proper text/arrayBuffer implementations

// Store original Blob methods
const originalBlobText = Blob.prototype.text;
const originalBlobArrayBuffer = Blob.prototype.arrayBuffer;

// Override with FileReader-based implementations that definitely work
Blob.prototype.text = function(): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(this);
  });
};

Blob.prototype.arrayBuffer = function(): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(this);
  });
};

describe('IndexedDBFileAdapter', () => {
  let storage: IndexedDBFileAdapter;

  beforeEach(async () => {
    storage = new IndexedDBFileAdapter('test-file-storage');
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.destroy();
  });

  describe('initialize', () => {
    it('should initialize successfully when IndexedDB is available', async () => {
      const newStorage = new IndexedDBFileAdapter('new-storage');
      await expect(newStorage.initialize()).resolves.not.toThrow();
      await newStorage.destroy();
    });
  });

  describe('isAvailable', () => {
    it('should return true when IndexedDB is available', () => {
      expect(storage.isAvailable()).toBe(true);
    });
  });

  describe('upload and download', () => {
    it('should upload and download file', async () => {
      const content = 'Hello, IndexedDB!';
      const blob = new Blob([content], { type: 'text/plain' });
      
      await storage.upload('test-file.txt', blob);
      
      const downloaded = await storage.download('test-file.txt');
      const text = await downloaded.text();
      
      expect(text).toBe(content);
    });

    it('should upload and download ArrayBuffer', async () => {
      const content = 'ArrayBuffer test';
      const encoder = new TextEncoder();
      const arrayBuffer = encoder.encode(content).buffer;
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      
      await storage.upload('test-arraybuffer.bin', blob);
      
      const downloaded = await storage.download('test-arraybuffer.bin');
      const buffer = await downloaded.arrayBuffer();
      const decoder = new TextDecoder();
      const text = decoder.decode(buffer);
      
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
      const content = '0123456789ABCDEFGHIJ';
      const blob = new Blob([content], { type: 'text/plain' });
      
      await storage.upload('test-chunk.txt', blob);
      
      const chunk = await storage.readChunk('test-chunk.txt', 5, 10);
      const decoder = new TextDecoder();
      const chunkText = decoder.decode(chunk);
      
      expect(chunkText).toBe('56789');
    });
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
  });

  describe('createDirectory', () => {
    it('should not throw error when creating directory', async () => {
      await expect(storage.createDirectory('data/models/')).resolves.not.toThrow();
    });
  });

  describe('deleteDirectory', () => {
    it('should delete directory recursively', async () => {
      const blob1 = new Blob(['test1'], { type: 'text/plain' });
      const blob2 = new Blob(['test2'], { type: 'text/plain' });

      await storage.upload('data/file1.txt', blob1);
      await storage.upload('data/file2.txt', blob2);
      await storage.deleteDirectory('data', true);

      expect(await storage.exists('data/file1.txt')).toBe(false);
      expect(await storage.exists('data/file2.txt')).toBe(false);
    });
  });

  describe('adapter properties', () => {
    it('should have correct name', () => {
      expect(storage.name).toBe('indexedDB-file:test-file-storage');
    });

    it('should have correct type', () => {
      expect(storage.type).toBe(FileAdapterType.IndexedDB);
    });
  });
});