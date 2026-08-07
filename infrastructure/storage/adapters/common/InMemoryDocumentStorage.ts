/**
 * 简单内存文档存储
 * @description 用于 RN 环境，实现 IDocumentStorage 接口
 */

import type { IDocumentStorage, QueryCriteria } from '../../interfaces/IDocumentStorage';

/**
 * 简单内存文档存储
 */
export class InMemoryDocumentStorage<T extends { id: string }> implements IDocumentStorage<T> {
  private documents: Map<string, T> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async insert(doc: T): Promise<string> {
    this.documents.set(doc.id, doc);
    return doc.id;
  }

  async insertMany(docs: T[]): Promise<string[]> {
    const ids: string[] = [];
    for (const doc of docs) {
      this.documents.set(doc.id, doc);
      ids.push(doc.id);
    }
    return ids;
  }

  async update(id: string, doc: Partial<T>): Promise<void> {
    const existing = this.documents.get(id);
    if (existing) {
      this.documents.set(id, { ...existing, ...doc } as T);
    }
  }

  async delete(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  async findById(id: string): Promise<T | null> {
    return this.documents.get(id) ?? null;
  }

  async find(criteria?: QueryCriteria): Promise<T[]> {
    let results = Array.from(this.documents.values());

    if (criteria?.where) {
      results = results.filter(doc => {
        for (const [key, value] of Object.entries(criteria.where!)) {
          if ((doc as Record<string, unknown>)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    if (criteria?.orderBy) {
      const order = criteria.orderDirection === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[criteria.orderBy!];
        const bVal = (b as Record<string, unknown>)[criteria.orderBy!];
        if (aVal === bVal) return 0;
        if (aVal === undefined || aVal === null) return order;
        if (bVal === undefined || bVal === null) return -order;
        return aVal < bVal ? -order : order;
      });
    }

    if (criteria?.offset !== undefined) {
      results = results.slice(criteria.offset);
    }

    if (criteria?.limit !== undefined) {
      results = results.slice(0, criteria.limit);
    }

    return results;
  }

  async findOne(criteria?: QueryCriteria): Promise<T | null> {
    const results = await this.find(criteria);
    return results[0] ?? null;
  }

  async count(criteria?: QueryCriteria): Promise<number> {
    if (!criteria?.where) {
      return this.documents.size;
    }
    const results = await this.find(criteria);
    return results.length;
  }

  async exists(id: string): Promise<boolean> {
    return this.documents.has(id);
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}
