/**
 * 归档 Provider
 * @description 特殊 Provider，从 URL 解析 SGF 数据，不发起网络请求
 * URL 格式: archive:<base64-encoded-sgf>?black=黑方&white=白方&size=19
 *
 * 注意：此 Provider 不执行归档操作，只解析数据返回 FetchResult
 * 归档由 GameFetchHelper.archive() 统一处理
 */

import type { IGameProvider } from '../base/IProvider';
import type { FetchResult, GameMetadata } from '../base/types';

/**
 * 归档 Provider
 * @description 从 URL 解析 SGF 数据，返回 FetchResult
 */
export class ArchiveProvider implements IGameProvider {
  readonly name = 'archive';
  readonly displayName = '本地归档';
  readonly urlPatterns = [/^archive:/];

  canHandle(url: string): boolean {
    return url.startsWith('archive:');
  }

  extractId(url: string): string | null {
    return `archive-${Date.now()}`;
  }

  async fetch(url: string): Promise<FetchResult> {
    try {
      const { sgf, metadata } = this.parseUrl(url);
      const gameId = 'recorder';

      return {
        success: true,
        source: 'archive',
        url,
        sgfContent: sgf,
        metadata: {
          source: 'archive',
          gameId,
          blackName: metadata['blackName'] as string,
          whiteName: metadata['whiteName'] as string,
          width: (metadata['size'] as number) ?? 19,
          height: (metadata['size'] as number) ?? 19,
          komi: 0,
          handicap: 0,
          rules: '',
          date: new Date().toISOString().split('T')[0] || '',
          movesCount: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        source: 'archive',
        url,
        sgfContent: null,
        metadata: this.createEmptyMetadata(),
        error: String(error),
      };
    }
  }

  /**
   * 解析归档 URL
   */
  private parseUrl(url: string): { sgf: string; metadata: Record<string, string | number> } {
    // URL 格式: archive:<base64>?black=...&white=...&size=...
    const withoutPrefix = url.slice(8); // 去掉 'archive:'
    const questionIndex = withoutPrefix.indexOf('?');
    const encoded = questionIndex >= 0 ? withoutPrefix.slice(0, questionIndex) : withoutPrefix;
    const query = questionIndex >= 0 ? withoutPrefix.slice(questionIndex + 1) : '';
    
    // Base64 解码 SGF
    const sgf = this.decodeBase64(encoded);
    
    // 解析查询参数
    const params = new URLSearchParams(query);
    const metadata: Record<string, string | number> = {
      blackName: params.get('black') ?? '黑方',
      whiteName: params.get('white') ?? '白方',
      size: parseInt(params.get('size') ?? '19', 10),
    };

    return { sgf, metadata };
  }

  /**
   * Base64 解码（支持 URL 安全编码，兼容浏览器和 Node.js）
   */
  private decodeBase64(encoded: string): string {
    if (!encoded) {
      throw new Error('Missing SGF content in archive URL');
    }
    // URL 安全 Base64 转标准 Base64
    const standardBase64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    // 补齐 padding
    const padded = standardBase64.padEnd(
      standardBase64.length + ((4 - (standardBase64.length % 4)) % 4),
      '='
    );
    // atob 解码后还原 Unicode
    return decodeURIComponent(
      Array.from(atob(padded), c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
  }

  /**
   * 创建空元数据
   */
  private createEmptyMetadata(): GameMetadata {
    return {
      source: 'archive',
      gameId: '',
      blackName: '',
      whiteName: '',
      width: 19,
      height: 19,
      komi: 0,
      handicap: 0,
      rules: '',
      date: '',
      movesCount: 0,
    };
  }
}