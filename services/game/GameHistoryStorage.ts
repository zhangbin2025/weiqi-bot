import type { IGameHistoryStorage, GameHistoryIndex, ArchiveParams, ArchiveResult, HistoryQuery } from './IGameHistoryStorage';
import type { IDocumentStorage, IFileStorage } from '../../infrastructure/storage';

/** 棋谱历史归档服务 */
export class GameHistoryStorage implements IGameHistoryStorage {
  private readonly indexStorage: IDocumentStorage<GameHistoryIndex>;
  private readonly fileStorage: IFileStorage;
  private readonly basePath: string;

  constructor(
    indexStorage: IDocumentStorage<GameHistoryIndex>,
    fileStorage: IFileStorage,
    basePath: string = 'games'
  ) {
    this.indexStorage = indexStorage;
    this.fileStorage = fileStorage;
    this.basePath = basePath;
  }

  async initialize(): Promise<void> {
    await this.indexStorage.initialize();
    await this.fileStorage.initialize();
  }

  async archive(params: ArchiveParams): Promise<ArchiveResult> {
    const ts = Date.now();
    const id = `${ts}-${params.gameId || 'game'}`;
    
    // 生成文件路径（使用 archiveId 作为文件名，保证唯一性）
    const date = new Date(ts);
    const datePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    const ext = params.type === 'sgf' ? 'sgf' : 'zip';
    const path = `${this.basePath}/files/${datePath}/${id}.${ext}`;

    // 存文件
    const content = params.type === 'sgf' 
      ? new Blob([params.content as string], { type: 'text/plain' })
      : params.content as Blob;
    
    await this.fileStorage.upload(path, content);
    const size = content.size;

    // 存索引
    const index: GameHistoryIndex = {
      id,
      ts,
      gameId: params.gameId,
      type: params.type,
      path,
      source: params.source,
      player: params.player,
      metadata: params.metadata,
      size,
    };
    await this.indexStorage.insert(index);

    return { id, path, size };
  }

  async findByTimeRange(start: Date, end: Date): Promise<GameHistoryIndex[]> {
    const all = await this.indexStorage.find();
    const startTs = start.getTime();
    const endTs = end.getTime();
    
    return all
      .filter(item => item.ts >= startTs && item.ts <= endTs)
      .sort((a, b) => b.ts - a.ts);
  }

  async findById(id: string): Promise<GameHistoryIndex | null> {
    const results = await this.indexStorage.find({ where: { id } });
    return results[0] ?? null;
  }

  async find(query: HistoryQuery): Promise<GameHistoryIndex[]> {
    const all = await this.indexStorage.find();
    
    let filtered = all;
    
    if (query.start && query.end) {
      const startTs = query.start.getTime();
      const endTs = query.end.getTime();
      filtered = filtered.filter(item => item.ts >= startTs && item.ts <= endTs);
    }
    if (query.gameId) {
      filtered = filtered.filter(item => item.gameId === query.gameId);
    }
    if (query.source) {
      filtered = filtered.filter(item => item.source === query.source);
    }
    if (query.player) {
      filtered = filtered.filter(item => item.player === query.player);
    }
    if (query.type) {
      filtered = filtered.filter(item => item.type === query.type);
    }

    return filtered.sort((a, b) => b.ts - a.ts);
  }

  async readContent(path: string): Promise<string | Blob> {
    const blob = await this.fileStorage.download(path);
    
    // 如果是 SGF 文件，返回字符串
    if (path.endsWith('.sgf')) {
      return await blob.text();
    }
    
    return blob;
  }

  async stats(): Promise<{ count: number; totalSize: number; earliest: Date | null; latest: Date | null }> {
    const all = await this.indexStorage.find();
    const count = all.length;
    const totalSize = all.reduce((sum, r) => sum + r.size, 0);
    
    const sorted = [...all].sort((a, b) => a.ts - b.ts);
    const earliest = sorted[0] ? new Date(sorted[0].ts) : null;
    const lastItem = sorted[sorted.length - 1]; const latest = lastItem ? new Date(lastItem.ts) : null;

    return { count, totalSize, earliest, latest };
  }

  async delete(id: string): Promise<void> {
    // 1. 查找索引记录
    const index = await this.findById(id);
    if (!index) {
      console.warn('[GameHistoryStorage] 归档不存在:', id);
      return;
    }

    // 2. 删除文件
    try {
      await this.fileStorage.delete(index.path);
      console.log('[GameHistoryStorage] 已删除文件:', index.path);
    } catch (error) {
      console.warn('[GameHistoryStorage] 删除文件失败:', index.path, error);
    }

    // 3. 删除索引
    try {
      await this.indexStorage.delete(id);
      console.log('[GameHistoryStorage] 已删除索引:', id);
    } catch (error) {
      console.warn('[GameHistoryStorage] 删除索引失败:', id, error);
    }
  }
}
