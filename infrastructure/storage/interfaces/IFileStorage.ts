/**
 * 文件存储接口
 * @description 定义文件存储操作，支持大文件、流式读写、分块传输
 * 
 * ## 适用场景
 * - AI 模型文件（几百MB甚至GB）
 * - 棋谱文件（SGF格式）
 * - 压缩文件、定式库
 * 
 * ## 环境选择
 * - **浏览器**：IndexedDBFileAdapter（容量 50-500MB）
 * - **Node.js**：NodeFileAdapter（无限制）
 * 
 * ## 使用示例
 * ```typescript
 * import { IndexedDBFileAdapter } from './infrastructure/storage';
 * 
 * const storage = new IndexedDBFileAdapter('weiqi-files');
 * await storage.initialize();
 * 
 * // 上传文件
 * const blob = new Blob(['棋谱内容...'], { type: 'text/plain' });
 * await storage.upload('games/game-001.sgf', blob);
 * 
 * // 下载文件
 * const file = await storage.download('games/game-001.sgf');
 * ```
 */

/**
 * 文件元数据
 */
export interface IFileMetadata {
  /** 文件路径 */
  path: string;

  /** 文件大小（字节） */
  size: number;

  /** MIME 类型 */
  contentType: string;

  /** 最后修改时间 */
  lastModified: Date;

  /** 校验和（可选） */
  checksum?: string;
}

/**
 * 文件存储接口
 * @description 提供文件的上传、下载、删除、查询等操作
 */
export interface IFileStorage {
  /**
   * 上传文件
   * @param path - 文件路径
   * @param data - 文件数据（Blob 或 ArrayBuffer）
   * @ai-example
   * await storage.upload('data/file.bin', blob);
   */
  upload(path: string, data: Blob | ArrayBuffer): Promise<void>;

  /**
   * 下载文件
   * @param path - 文件路径
   * @returns 文件数据（Blob）
   * @ai-example
   * const blob = await storage.download('data/file.bin');
   */
  download(path: string): Promise<Blob>;

  /**
   * 删除文件
   * @param path - 文件路径
   * @ai-example
   * await storage.delete('data/file.bin');
   */
  delete(path: string): Promise<void>;

  /**
   * 检查文件是否存在
   * @param path - 文件路径
   * @returns 是否存在
   * @ai-example
   * const exists = await storage.exists('data/file.bin');
   */
  exists(path: string): Promise<boolean>;

  /**
   * 获取文件元数据
   * @param path - 文件路径
   * @returns 文件元数据
   * @ai-example
   * const meta = await storage.getMetadata('data/file.bin');
   */
  getMetadata(path: string): Promise<IFileMetadata>;

  /**
   * 分块读取文件
   * @param path - 文件路径
   * @param start - 起始字节位置
   * @param end - 结束字节位置
   * @returns 文件数据块
   * @ai-example
   * const chunk = await storage.readChunk('data/file.bin', 0, 1024);
   */
  readChunk(path: string, start: number, end: number): Promise<ArrayBuffer>;

  /**
   * 列出目录下的文件
   * @param dirPath - 目录路径
   * @returns 文件路径列表
   * @ai-example
   * const files = await storage.listFiles('data/');
   */
  listFiles(dirPath: string): Promise<string[]>;

  /**
   * 创建目录
   * @param dirPath - 目录路径
   * @ai-example
   * await storage.createDirectory('data/models/');
   */
  createDirectory(dirPath: string): Promise<void>;

  /**
   * 删除目录
   * @param dirPath - 目录路径
   * @param recursive - 是否递归删除
   * @ai-example
   * await storage.deleteDirectory('data/old/', true);
   */
  deleteDirectory(dirPath: string, recursive?: boolean): Promise<void>;
  /** 初始化存储 */
  initialize(): Promise<void>;
}

/**
 * 文件存储适配器接口
 * @description 扩展 IFileStorage，增加适配器管理能力
 */
export interface IFileStorageAdapter extends IFileStorage {
  /**
   * 适配器名称
   */
  readonly name: string;

  /**
   * 适配器类型
   */
  readonly type: FileAdapterType;

  /**
   * 初始化适配器
   */
  initialize(): Promise<void>;

  /**
   * 销毁适配器
   */
  destroy(): Promise<void>;

  /**
   * 检查适配器是否可用
   */
  isAvailable(): boolean;
}

/**
 * 文件适配器类型枚举
 */
export enum FileAdapterType {
  FileSystemAPI = 'fileSystemAPI',
  IndexedDB = 'indexedDB',
  NodeFS = 'nodeFS',
  MiniProgramFS = 'miniProgramFS',
}
