import * as fs from 'fs';
import * as path from 'path';
import {
  IFileStorageAdapter,
  IFileMetadata,
  FileAdapterType,
} from '../../interfaces/IFileStorage';

/**
 * Node.js 文件存储适配器
 * @description 使用 fs 模块实现文件存储
 */
export class NodeFileAdapter implements IFileStorageAdapter {
  readonly name: string;
  readonly type = FileAdapterType.NodeFS;

  private basePath: string;

  constructor(basePath: string = './storage') {
    this.basePath = basePath;
    this.name = `nodeFS:${basePath}`;
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async destroy(): Promise<void> {}
  isAvailable(): boolean { return typeof fs !== 'undefined'; }

  async upload(filePath: string, data: Blob | ArrayBuffer): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(fullPath, buffer);
  }

  async download(filePath: string): Promise<Blob> {
    const fullPath = this.resolvePath(filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(fullPath);
    return new Blob([buffer]);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    return fs.existsSync(fullPath);
  }

  async getMetadata(filePath: string): Promise<IFileMetadata> {
    const fullPath = this.resolvePath(filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(fullPath);

    return {
      path: filePath,
      size: stats.size,
      contentType: this.getContentType(filePath),
      lastModified: stats.mtime,
    };
  }

  async readChunk(filePath: string, start: number, end: number): Promise<ArrayBuffer> {
    const fullPath = this.resolvePath(filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fd = fs.openSync(fullPath, 'r');
    const length = end - start;
    const buffer = Buffer.alloc(length);

    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);

    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const fullPath = this.resolvePath(dirPath);

    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const files = fs.readdirSync(fullPath);
    return files.map((file) => path.join(dirPath, file));
  }

  async createDirectory(dirPath: string): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  async deleteDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
    const fullPath = this.resolvePath(dirPath);

    if (fs.existsSync(fullPath)) {
      if (recursive) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.rmdirSync(fullPath);
      }
    }
  }

  private resolvePath(filePath: string): string {
    return path.join(this.basePath, filePath);
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.bin': 'application/octet-stream',
      '.sgf': 'application/x-go-sgf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
