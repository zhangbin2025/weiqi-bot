/**
 * Gzip JSON 加载器
 * @description 处理 gzip 压缩 JSON 文件的下载、解压、本地缓存
 */

import pako from 'pako';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IFileStorage } from '../../infrastructure/storage/interfaces/IFileStorage';

/** 加载进度回调 */
export type GzipLoadProgressCallback = (percent: number, status: string) => void;

/**
 * Gzip JSON 加载器
 */
export class GzipJsonLoader {
  constructor(
    private readonly network: NetworkManager,
    private readonly fileStorage: IFileStorage,
  ) {}

  /**
   * 加载 gzip 压缩的 JSON 文件（带本地缓存）
   */
  async load<T>(
    url: string,
    cachePath: string,
    onProgress?: GzipLoadProgressCallback,
  ): Promise<T> {
    // 1. 尝试从本地缓存读取
    try {
      onProgress?.(10, '检查本地缓存');
      const blob = await this.fileStorage.download(cachePath);
      const buffer = await blob.arrayBuffer();
      const compressed = new Uint8Array(buffer);
      // 检查是否为 gzip 格式
      const isGzipped = compressed[0] === 0x1f && compressed[1] === 0x8b;
      const text = isGzipped
        ? pako.ungzip(compressed, { to: 'string' })
        : new TextDecoder().decode(compressed);
      onProgress?.(80, '本地缓存命中');
      return JSON.parse(text);
    } catch {
      // 缓存未命中，继续网络下载
    }

    // 2. 从网络下载
    onProgress?.(20, '下载定式库');
    let response;
    try {
      response = await this.network.request<ArrayBuffer>({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
      });
    } catch (err) {
      throw new Error(`下载定式库失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.data) {
      throw new Error(`Failed to load: ${url}`);
    }

    onProgress?.(70, '下载完成');

    // 3. 解压
    let compressed: Uint8Array;
    let data: T;
    try {
      compressed = new Uint8Array(response.data);
      // 检查是否为 gzip 格式（前两字节 0x1f 0x8b）
      const isGzipped = compressed[0] === 0x1f && compressed[1] === 0x8b;
      if (isGzipped) {
        const decompressed = pako.ungzip(compressed, { to: 'string' });
        data = JSON.parse(decompressed);
      } else {
        // 浏览器已自动解压（Content-Encoding: gzip），直接解析
        const text = new TextDecoder().decode(compressed);
        data = JSON.parse(text);
      }
    } catch (err) {
      throw new Error(`解压定式库失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. 缓存到本地
    onProgress?.(75, '保存本地缓存');
    try {
      const blobData = new Uint8Array(compressed); // 复制数据
      await this.fileStorage.upload(cachePath, new Blob([blobData as BlobPart]));
    } catch {
      // 缓存失败不影响使用
    }

    return data;
  }
}
