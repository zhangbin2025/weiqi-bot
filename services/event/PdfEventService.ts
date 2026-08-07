/**
 * PDF 导入比赛服务
 * @description 管理 PDF 导入比赛的持久化存储、幂等匹配、增删改查
 *
 * 存储方式：IndexedDB (weiqi-bot-pdf-events / events)
 * 幂等策略：同 title + 同 groupName + 同 round → 覆盖
 */

import type { PdfEvent, PdfGroup, PdfRound } from './PdfEventTypes';
import type { Match } from './types';
import { openDatabase, getObjectStore, promisifyRequest, promisifyTransaction } from '../../infrastructure/storage/adapters/web/IndexedDBHelper';

const DB_NAME = 'weiqi-bot-pdf-events';
const STORE_NAME = 'events';

function uuid(): string {
  return crypto.randomUUID();
}

export class PdfEventService {
  private db: IDBDatabase | null = null;

  /** 确保 db 可用，断开则重连 */
  private async ensureDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = await openDatabase(DB_NAME, STORE_NAME);
    return this.db;
  }

  /** 兼容旧调用 */
  async init(): Promise<void> { await this.ensureDb(); }

  async listEvents(): Promise<PdfEvent[]> {
    const db = await this.ensureDb();
    const store = getObjectStore(db, STORE_NAME, 'readonly');
    const all = await promisifyRequest<PdfEvent[]>(store.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getEvent(eventId: string): Promise<PdfEvent | null> {
    const db = await this.ensureDb();
    const store = getObjectStore(db, STORE_NAME, 'readonly');
    return await promisifyRequest<PdfEvent | null>(store.get(eventId));
  }

  async findEvent(title: string): Promise<PdfEvent | null> {
    const all = await this.listEvents();
    return all.find(e => e.title === title) ?? null;
  }

  async importRound(title: string, groupName: string, round: number, matches: Match[], pdfScores: Record<string, number>): Promise<PdfEvent> {
    const db = await this.ensureDb();

    const all = await this.listEvents();
    let event = all.find(e => e.title === title) ?? null;

    const now = Date.now();
    const newRound: PdfRound = { round, matches, pdfScores, importedAt: now };

    if (!event) {
      event = {
        id: uuid(),
        title,
        groups: [{
          id: uuid(),
          name: groupName,
          rounds: [newRound],
        }],
        createdAt: now,
        updatedAt: now,
      };
    } else {
      let group = event.groups.find(g => g.name === groupName);
      if (!group) {
        group = { id: uuid(), name: groupName, rounds: [newRound] };
        event.groups.push(group);
      } else {
        const existIdx = group.rounds.findIndex(r => r.round === round);
        if (existIdx >= 0) {
          group.rounds[existIdx] = newRound;
        } else {
          group.rounds.push(newRound);
          group.rounds.sort((a, b) => a.round - b.round);
        }
      }
      event.updatedAt = now;
    }

    const store = getObjectStore(db, STORE_NAME, 'readwrite');
    await promisifyRequest(store.put(event));
    await promisifyTransaction(store.transaction);
    return event;
  }

  async saveEvent(event: PdfEvent): Promise<void> {
    const db = await this.ensureDb();
    event.updatedAt = Date.now();
    const store = getObjectStore(db, STORE_NAME, 'readwrite');
    await promisifyRequest(store.put(event));
    await promisifyTransaction(store.transaction);
  }

  async clearAll(): Promise<void> {
    const db = await this.ensureDb();
    const store = getObjectStore(db, STORE_NAME, 'readwrite');
    await promisifyRequest(store.clear());
    await promisifyTransaction(store.transaction);
  }

  getGroupMatches(event: PdfEvent, groupId: string): Match[] {
    const group = event.groups.find(g => g.id === groupId);
    if (!group) return [];
    return group.rounds.flatMap(r => r.matches);
  }

  getGroupRoundCount(event: PdfEvent, groupId: string): number {
    const group = event.groups.find(g => g.id === groupId);
    if (!group) return 0;
    return group.rounds.length;
  }
}
