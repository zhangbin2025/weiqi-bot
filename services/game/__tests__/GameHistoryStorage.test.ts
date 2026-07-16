import { describe, it, expect, beforeEach } from 'vitest';
import { GameHistoryStorage } from '../GameHistoryStorage';
import type { GameHistoryIndex } from '../IGameHistoryStorage';
import type { IDocumentStorage, IFileStorage } from '../../../infrastructure/storage';

/** 内存文档存储适配器(测试用) */
class MockDocumentStorage implements IDocumentStorage<GameHistoryIndex> {
  private data: Map<string, GameHistoryIndex> = new Map();

  async initialize(): Promise<void> {}

  async insert(doc: GameHistoryIndex): Promise<string> {
    this.data.set(doc.id, doc);
    return doc.id;
  }

  async insertMany(docs: GameHistoryIndex[]): Promise<string[]> {
    return Promise.all(docs.map(doc => this.insert(doc)));
  }

  async update(id: string, doc: Partial<GameHistoryIndex>): Promise<void> {
    const existing = this.data.get(id);
    if (existing) {
      this.data.set(id, { ...existing, ...doc });
    }
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  async deleteMany(ids: string[]): Promise<void> {
    ids.forEach(id => this.data.delete(id));
  }

  async findById(id: string): Promise<GameHistoryIndex | null> {
    return this.data.get(id) ?? null;
  }

  async find(criteria?: { where?: Record<string, unknown> }): Promise<GameHistoryIndex[]> {
    let results = Array.from(this.data.values());

    if (criteria?.where) {
      for (const [key, value] of Object.entries(criteria.where)) {
        results = results.filter(item => item[key as keyof GameHistoryIndex] === value);
      }
    }

    return results;
  }

  async findOne(criteria?: { where?: Record<string, unknown> }): Promise<GameHistoryIndex | null> {
    const results = await this.find(criteria);
    return results[0] ?? null;
  }

  async count(criteria?: { where?: Record<string, unknown> }): Promise<number> {
    const results = await this.find(criteria);
    return results.length;
  }

  async exists(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/** 内存文件存储适配器(测试用) */
class MockFileStorage implements IFileStorage {
  private files: Map<string, Blob> = new Map();

  readonly name = 'mock';
  readonly type = 'indexedDB' as const;

  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
  isAvailable(): boolean { return true; }

  async upload(path: string, data: Blob | ArrayBuffer): Promise<void> {
    const blob = data instanceof ArrayBuffer ? new Blob([data]) : data;
    this.files.set(path, blob);
  }

  async download(path: string): Promise<Blob> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async getMetadata(path: string): Promise<{ path: string; size: number; contentType: string; lastModified: Date }> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return {
      path,
      size: file.size,
      contentType: file.type,
      lastModified: new Date(),
    };
  }

  async readChunk(path: string, start: number, end: number): Promise<ArrayBuffer> {
    const file = await this.download(path);
    return file.slice(start, end).arrayBuffer();
  }

  async listFiles(dirPath: string): Promise<string[]> {
    return Array.from(this.files.keys()).filter(p => p.startsWith(dirPath));
  }

  async createDirectory(): Promise<void> {}
  async deleteDirectory(): Promise<void> {}
}

describe('GameHistoryStorage', () => {
  let storage: GameHistoryStorage;
  let indexStorage: MockDocumentStorage;
  let fileStorage: MockFileStorage;

  beforeEach(async () => {
    indexStorage = new MockDocumentStorage();
    fileStorage = new MockFileStorage();
    storage = new GameHistoryStorage(indexStorage, fileStorage, 'games');
    await storage.initialize();
  });

  describe('archive', () => {
    it('应该归档单个 SGF 文件', async () => {
      const result = await storage.archive({
        gameId: 'game-001',
        type: 'sgf',
        content: '(;GM[1]SZ[19])',
        source: 'foxwq',
        player: '柯洁',
      });

      expect(result.id).toMatch(/^\d+-game-001$/);
      expect(result.path).toMatch(/^games\/files\/\d{4}\/\d{2}\/\d{2}\/\d+-game-001\.sgf$/);
      expect(result.size).toBe(14);
    });

    it('应该归档压缩包文件', async () => {
      const zipContent = new Blob(['zip-content'], { type: 'application/zip' });
      const result = await storage.archive({
        gameId: 'game-002',
        type: 'archive',
        content: zipContent,
        source: 'ogs',
      });

      expect(result.id).toMatch(/^\d+-game-002$/);
      expect(result.path).toMatch(/\.zip$/);
      expect(result.size).toBe(11);
    });
  });

  describe('findByTimeRange', () => {
    it('应该按时间范围查询索引', async () => {
      const now = Date.now();

      await storage.archive({ gameId: 'g1', type: 'sgf', content: 'a', source: 'foxwq' });
      await new Promise(r => setTimeout(r, 10));
      await storage.archive({ gameId: 'g2', type: 'sgf', content: 'b', source: 'foxwq' });
      await new Promise(r => setTimeout(r, 10));
      await storage.archive({ gameId: 'g3', type: 'sgf', content: 'c', source: 'foxwq' });

      const start = new Date(now - 1000);
      const end = new Date(now + 10000);
      const results = await storage.findByTimeRange(start, end);

      expect(results.length).toBe(3);
      expect(results[0].gameId).toBe('g3'); // 最新的在前
    });
  });

  describe('findById', () => {
    it('应该按归档ID查询', async () => {
      const result = await storage.archive({
        gameId: 'unique-game',
        type: 'sgf',
        content: 'test-sgf',
        source: 'foxwq',
      });
      
      const index = await storage.findById(result.id);
      expect(index).not.toBeNull();
      expect(index?.gameId).toBe('unique-game');
    });

    it('找不到时返回 null', async () => {
      const result = await storage.findById('not-exist');
      expect(result).toBeNull();
    });
  });

  describe('find', () => {
    it('应该按来源过滤', async () => {
      await storage.archive({ gameId: 'g1', type: 'sgf', content: 'a', source: 'foxwq' });
      await storage.archive({ gameId: 'g2', type: 'sgf', content: 'b', source: 'ogs' });

      const results = await storage.find({ source: 'foxwq' });
      expect(results.length).toBe(1);
      expect(results[0].source).toBe('foxwq');
    });

    it('应该按类型过滤', async () => {
      await storage.archive({ gameId: 'g1', type: 'sgf', content: 'a', source: 'foxwq' });
      await storage.archive({ gameId: 'g2', type: 'archive', content: new Blob(['x']), source: 'foxwq' });

      const results = await storage.find({ type: 'archive' });
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('archive');
    });
  });

  describe('readContent', () => {
    it('应该读取 SGF 文件为字符串', async () => {
      const archiveResult = await storage.archive({
        gameId: 'read-test',
        type: 'sgf',
        content: '(;GM[1])',
        source: 'foxwq',
      });
      
      const index = await storage.findById(archiveResult.id);
      expect(index).not.toBeNull();
      
      const content = await storage.readContent(index!.path);
      expect(content).toBe('(;GM[1])');
    });

    it('应该读取压缩包为 Blob', async () => {
      const original = new Blob(['zip-data'], { type: 'application/zip' });
      const archiveResult = await storage.archive({
        gameId: 'read-zip',
        type: 'archive',
        content: original,
        source: 'foxwq',
      });
      
      const index = await storage.findById(archiveResult.id);
      expect(index).not.toBeNull();
      
      const content = await storage.readContent(index!.path);
      expect(content).toBeInstanceOf(Blob);
    });
  });

  describe('stats', () => {
    it('应该返回正确的统计信息', async () => {
      await storage.archive({ gameId: 's1', type: 'sgf', content: 'abc', source: 'foxwq' });
      await storage.archive({ gameId: 's2', type: 'sgf', content: 'def', source: 'foxwq' });

      const stats = await storage.stats();

      expect(stats.count).toBe(2);
      expect(stats.totalSize).toBe(6); // 3 + 3
      expect(stats.earliest).toBeInstanceOf(Date);
      expect(stats.latest).toBeInstanceOf(Date);
    });

    it('空存储时应该返回零值', async () => {
      const stats = await storage.stats();

      expect(stats.count).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.earliest).toBeNull();
      expect(stats.latest).toBeNull();
    });
  });
});