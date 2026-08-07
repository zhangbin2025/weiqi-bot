import * as fs from 'fs';
import * as path from 'path';
import {
  IKeyValueStorageAdapter,
  StorageAdapterType,
} from '../../interfaces/IKeyValueStorage';
import {
  IDocumentStorageAdapter,
  QueryCriteria,
} from '../../interfaces/IDocumentStorage';

/**
 * JSON 文件存储适配器
 * @description 使用 JSON 文件实现键值存储和文档存储
 */
export class JsonFileAdapter<T extends { id: string } = { id: string }>
  implements IKeyValueStorageAdapter, IDocumentStorageAdapter<T>
{
  readonly name: string;
  readonly type = StorageAdapterType.JsonFile;

  private filePath: string;
  private data: Record<string, unknown> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    this.name = `jsonFile:${filePath}`;
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      } catch { this.data = {}; }
    }
  }

  async destroy(): Promise<void> { this.data = {}; }
  isAvailable(): boolean { return typeof fs !== 'undefined'; }

  // 键值存储接口
  async read<V>(key: string): Promise<V | null> {
    return this.data[key] !== undefined ? (this.data[key] as V) : null;
  }

  async write<V>(key: string, data: V): Promise<void> {
    this.data[key] = data;
    await this.save();
  }

  async delete(key: string): Promise<void> {
    delete this.data[key];
    await this.save();
  }

  async exists(key: string): Promise<boolean> {
    return this.data[key] !== undefined;
  }

  async listKeys(pattern?: string): Promise<string[]> {
    const keys = Object.keys(this.data);
    if (pattern) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      return keys.filter((key) => regex.test(key));
    }
    return keys;
  }

  async clear(): Promise<void> {
    this.data = {};
    await this.save();
  }

  // 文档存储接口
  async insert(doc: T): Promise<string> {
    this.data[doc.id] = doc;
    await this.save();
    return doc.id;
  }

  async insertMany(docs: T[]): Promise<string[]> {
    for (const doc of docs) this.data[doc.id] = doc;
    await this.save();
    return docs.map((d) => d.id);
  }

  async update(id: string, doc: Partial<T>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Document with id "${id}" not found`);
    this.data[id] = { ...existing, ...doc };
    await this.save();
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) delete this.data[id];
    await this.save();
  }

  async findById(id: string): Promise<T | null> {
    return this.data[id] !== undefined ? (this.data[id] as T) : null;
  }

  async find(criteria?: QueryCriteria): Promise<T[]> {
    let results = Object.values(this.data) as T[];

    if (criteria?.where) {
      results = results.filter((doc) => this.matchWhere(doc, criteria.where!));
    }

    if (criteria?.orderBy) {
      const dir = criteria.orderDirection === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const aVal = (a as any)[criteria.orderBy!];
        const bVal = (b as any)[criteria.orderBy!];
        return aVal < bVal ? -1 * dir : aVal > bVal ? 1 * dir : 0;
      });
    }

    if (criteria?.offset) results = results.slice(criteria.offset);
    if (criteria?.limit) results = results.slice(0, criteria.limit);

    return results;
  }

  async findOne(criteria?: QueryCriteria): Promise<T | null> {
    const results = await this.find(criteria);
    return results.length > 0 ? (results[0] as T | null) : null;
  }

  async count(criteria?: QueryCriteria): Promise<number> {
    return criteria ? (await this.find(criteria)).length : Object.keys(this.data).length;
  }

  private async save(): Promise<void> {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private matchWhere(doc: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => (doc as any)[key] === value);
  }
}
