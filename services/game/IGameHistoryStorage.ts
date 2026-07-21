import type { IDocumentStorage, IFileStorage } from '../../infrastructure/storage';

/** 历史记录索引 */
export interface GameHistoryIndex {
  id: string;           // ts-gameId 格式
  ts: number;           // 时间戳（毫秒）
  gameId: string;       // 棋谱ID
  type: 'sgf' | 'archive';
  path: string;         // 文件路径
  source: string;       // 来源（foxwq/ogs/...）
  player?: string | undefined;      // 棋手名
  metadata?: Record<string, unknown> | undefined;
  size: number;         // 文件大小（字节）
}

/** 归档参数 */
export interface ArchiveParams {
  gameId: string;
  type: 'sgf' | 'archive';
  content: string | Blob;   // SGF字符串 或 Blob（压缩包）
  source: string;
  player?: string;
  metadata?: Record<string, unknown>;
}

/** 归档结果 */
export interface ArchiveResult {
  id: string;
  path: string;
  size: number;
}

/** 查询条件 */
export interface HistoryQuery {
  start?: Date;
  end?: Date;
  gameId?: string;
  source?: string;
  player?: string;
  type?: 'sgf' | 'archive';
}

/** 棋谱历史归档接口 */
export interface IGameHistoryStorage {
  /** 归档一条下载记录 */
  archive(params: ArchiveParams): Promise<ArchiveResult>;

  /** 按时间范围查询索引 */
  findByTimeRange(start: Date, end: Date): Promise<GameHistoryIndex[]>;

  /** 按归档ID查询 */
  findById(id: string): Promise<GameHistoryIndex | null>;

  /** 按条件查询 */
  find(query: HistoryQuery): Promise<GameHistoryIndex[]>;

  /** 读取实际内容 */
  readContent(path: string): Promise<string | Blob>;

  /** 获取统计信息 */
  stats(): Promise<{ count: number; totalSize: number; earliest: Date | null; latest: Date | null }>;

  /** 删除归档（包括索引和文件） */
  delete(id: string): Promise<void>;

  /** 初始化存储 */
  initialize(): Promise<void>;
}
