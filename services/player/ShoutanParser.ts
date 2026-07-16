/**
 * @fileoverview 手谈网站 HTML 解析器
 */

import { HtmlParserBase } from '../../infrastructure/utils/html';
import type { ShoutanPlayer } from './types';

/**
 * 手谈 HTML 解析器
 */
class ShoutanHtmlParser extends HtmlParserBase {
  /**
   * 解析手谈 HTML 响应
   * @param html - HTML 响应内容
   * @param name - 棋手姓名
   * @returns 解析出的棋手列表
   */
  parseShoutanHtml(html: string, name: string): ShoutanPlayer[] {
    const players: ShoutanPlayer[] = [];
    const matches = this.parseSelfClosingTag(html, 'Xs');

    for (const attrs of matches) {
      if (attrs['编号']) {
        players.push({
          name: attrs['姓名'] ?? name,
          region: attrs['地区'] ?? '',
          title: attrs['称谓'] ?? '',
          rating: parseFloat(attrs['等级分'] ?? '0') || 0,
          rank: parseInt(attrs['全国排名'] ?? '0', 10) || 0,
          games: parseInt(attrs['对局次数'] ?? '0', 10) || 0,
          detailUrl: this.buildShoutanDetailUrl(attrs),
        });
      }
    }

    return players;
  }

  /**
   * 构建手谈详情 URL
   * @param attrs - 属性键值对
   * @returns 详情页面 URL（原始链接，不含代理前缀）
   */
  buildShoutanDetailUrl(attrs: Record<string, string>): string {
    const xml = `<Redi Ns="Sp" Jk="等级分明细" Yh="${attrs['yh'] ?? ''}" 选手号="${attrs['编号']}"/>`;
    const encoded = btoa(unescape(encodeURIComponent(xml)));
    // ✅ 只返回原始 URL，网络层负责加代理前缀
    return `https://v.dzqzd.com/SpBody.aspx?r=${encoded}`;
  }
}

// 导出单例和便捷函数
const parser = new ShoutanHtmlParser();

export function parseShoutanHtml(
  html: string,
  name: string
): ShoutanPlayer[] {
  return parser.parseShoutanHtml(html, name);
}

export function buildShoutanDetailUrl(
  attrs: Record<string, string>
): string {
  return parser.buildShoutanDetailUrl(attrs);
}

export { ShoutanHtmlParser };
