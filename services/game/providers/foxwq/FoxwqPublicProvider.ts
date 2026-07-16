/**
 * @fileoverview 野狐围棋公开棋谱功能
 */

import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { PublicQipu, PublicQipuDetail } from './types';

/** 野狐公开棋谱基础 URL */
const FOXWQ_PUBLIC_BASE = 'https://www.foxwq.com';

/** 最大翻页数量（防止死循环） */
const MAX_PAGES = 50;

/**
 * 野狐围棋公开棋谱提供者
 */
export class FoxwqPublicProvider {
  constructor(
    private readonly network: NetworkManager
  ) {}

  /**
   * 获取公开棋谱列表（支持翻页）
   * @param date - 可选，指定日期 'YYYY-MM-DD'，找到该日期最后一盘即停止
   */
  async fetchPublicQipuList(date?: string): Promise<PublicQipu[]> {
    const links: PublicQipu[] = [];
    let page = 1;
    let foundDate = false;
    let dateDisappeared = false;

    while (page <= MAX_PAGES) {
      const url = page === 1
        ? `${FOXWQ_PUBLIC_BASE}/qipu.html`
        : `${FOXWQ_PUBLIC_BASE}/qipu/index/p/${page}.html`;

      const response = await this.network.request<string>({
        url,
        method: 'GET',
        responseType: 'text',
      });
      const html = response.data;

      // 检查本页是否有目标日期
      const hasDate = date ? html.includes(date) : true;

      // 如果目标日期曾出现过，但现在消失了，说明已经过了该日期的范围
      if (date && foundDate && !hasDate) {
        dateDisappeared = true;
        break;
      }

      // 从当前页提取棋谱
      const pageLinks = this.extractQipuFromHtml(html, date);
      links.push(...pageLinks);

      if (pageLinks.length > 0 && date) {
        foundDate = true;
      }

      // 检查是否有下一页
      const hasNextPage = html.includes('下页')
        || html.includes(`/qipu/index/p/${page + 1}.html`);
      if (!hasNextPage) break;

      page++;
    }

    return links;
  }

  /**
   * 从 HTML 中提取棋谱链接
   * @param html - 页面 HTML
   * @param date - 可选，只保留该日期的棋谱
   */
  private extractQipuFromHtml(html: string, date?: string): PublicQipu[] {
    const links: PublicQipu[] = [];
    const linkRegex = /<a[^>]*href="(\/qipu\/newlist\/id\/\d+\.html)"[^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const linkUrl = match[1];
      const matchIndex = match.index;
      const beforeLink = html.lastIndexOf('<tr', matchIndex);
      const afterLink = html.indexOf('</tr>', matchIndex);

      if (beforeLink === -1 || afterLink === -1) continue;

      const rowHtml = html.substring(beforeLink, afterLink + 5);
      const titleMatch = rowHtml.match(/<h4[^>]*>(.*?)<\/h4>/i);
      const title = titleMatch
        ? titleMatch[1]!.replace(/<[^>]+>/g, '').trim()
        : '未知';

      const dateMatch = rowHtml.match(/(\d{4}-\d{2}-\d{2})/);
      const qipuDate = dateMatch ? dateMatch[1] : '';

      if (date && qipuDate !== date) continue;

      links.push({
        title,
        url: `${FOXWQ_PUBLIC_BASE}${linkUrl}`,
        date: qipuDate ?? '',
      });
    }

    return links;
  }

  /**
   * 下载公开棋谱 SGF
   */
  async fetchPublicQipuSgf(url: string): Promise<PublicQipuDetail> {
    const response = await this.network.request<string>({
      url,
      method: 'GET',
      responseType: 'text',
    });

    const html = response.data;
    const sgfStart = html.indexOf('(;GM[1]FF[4]');
    if (sgfStart === -1) {
      throw new Error('无法提取 SGF 内容');
    }

    const sgfRemainder = html.substring(sgfStart);
    const htmlTagMatch = sgfRemainder.match(/<\/?[a-zA-Z][^>]*>/);

    let sgf: string;
    if (htmlTagMatch) {
      sgf = sgfRemainder.substring(0, htmlTagMatch.index);
    } else {
      const sgfMatch = html.match(/\(;GM\[1\]FF\[4\][\s\S]*?\)\s*\)\s*\)/);
      sgf = sgfMatch ? sgfMatch[0] : '';
    }

    sgf = sgf.trim();
    if (!sgf) {
      throw new Error('SGF 内容为空');
    }

    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const title = titleMatch
      ? titleMatch[1]!.replace(/<[^>]+>/g, '').trim()
      : '未知';

    const dateMatch = html.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : '';

    return { sgf, title, date: date ?? '' };
  }
}
