/**
 * 基于 SessionStorageService 的页面缓存实现
 * @module presentation/shells/web/shared/SessionPageCache
 */

import type { IPageCache } from '../../../core/interfaces/IPageCache';
import type { ISessionStorageService } from '../../../services/session';

/**
 * 页面缓存实现
 * 
 * 使用内存缓存实现同步接口，异步持久化到 sessionStorage。
 * 适用于页面返回导航时恢复数据的场景。
 */
export class SessionPageCache implements IPageCache {
  private cache: Map<string, string> = new Map(); // 内存缓存
  
  constructor(private readonly sessionService: ISessionStorageService) {}

  /** 从 sessionStorage 恢复缓存到内存（需在页面初始化时调用） */
  async init(): Promise<void> {
    // 直接遍历 sessionStorage，恢复 event-detail-* 相关的缓存
    const namespace = 'weiqi-bot';
    const prefix = `${namespace}:event-detail-`;
    for (let i = 0; i < sessionStorage.length; i++) {
      const fullKey = sessionStorage.key(i);
      if (fullKey && fullKey.startsWith(prefix)) {
        const key = fullKey.substring(namespace.length + 1); // 去掉 "weiqi-bot:" 前缀
        const raw = sessionStorage.getItem(fullKey);
        if (raw) {
          try {
            // SessionStorageAdapter 写入时做了 JSON.stringify，需要 parse 取出原始字符串
            const parsed = JSON.parse(raw);
            this.cache.set(key, typeof parsed === 'string' ? parsed : raw);
          } catch {
            this.cache.set(key, raw);
          }
        }
      }
    }
  }

  /**
   * 获取缓存（同步，从内存读取）
   */
  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * 设置缓存（同步写入内存，异步保存到 sessionStorage）
   */
  set(key: string, value: string): void {
    this.cache.set(key, value);
    // 异步保存，不阻塞
    this.sessionService.set(key, value).catch(console.error);
  }

  /**
   * 删除缓存（同步删除内存，异步删除 sessionStorage）
   */
  remove(key: string): void {
    this.cache.delete(key);
    // 异步删除，不阻塞
    this.sessionService.remove(key).catch(console.error);
  }
}
