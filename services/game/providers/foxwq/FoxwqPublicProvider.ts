/**
 * @fileoverview 野狐围棋公开棋谱功能
 */

import type { NetworkManager } from "../../../../infrastructure/network/core/NetworkManager";
import type { PublicQipu, PublicQipuDetail } from "./types";
import { FoxwqChessProvider } from "./FoxwqChessProvider";

/** 野狐公开棋谱基础 URL */
const FOXWQ_PUBLIC_BASE = "https://www.foxwq.com";

/** 最大翻页数量（防止死循环） */
const MAX_PAGES = 50;

/**
 * 野狐围棋公开棋谱提供者
 */
export class FoxwqPublicProvider {
  private readonly chessProvider: FoxwqChessProvider;

  constructor(private readonly network: NetworkManager) {
    this.chessProvider = new FoxwqChessProvider(network);
  }

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
      const url =
        page === 1
          ? `${FOXWQ_PUBLIC_BASE}/qipu.html`
          : `${FOXWQ_PUBLIC_BASE}/qipu/index/p/${page}.html`;

      const response = await this.network.request<string>({
        url,
        method: "GET",
        responseType: "text",
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
      const hasNextPage =
        html.includes("下页") || html.includes(`/qipu/index/p/${page + 1}.html`);
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

    // 新版H5分享链接格式：
    // <h4 class="qipu-title">
    //   <a href="https://h5.foxwq.com/yehunewshare/?chessid=xxx&title=xxx">标题</a>
    // </h4>
    // <td class="qipu-time text-right">2026-07-20 12:55</td>

    // 匹配每个棋谱行的标题和链接
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[0];

      // 提取标题和链接
      const titleLinkMatch = rowHtml.match(
        /<h4[^>]*class="[^"]*qipu-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h4>/i
      );

      if (!titleLinkMatch) continue;

      const linkUrl = titleLinkMatch[1]!;
      const title = titleLinkMatch[2]!.trim();

      // 提取日期（支持多个class，如 class="qipu-time text-right"）
      const dateMatch = rowHtml.match(/<td[^>]*class="[^"]*qipu-time[^"]*"[^>]*>([^<]+)<\/td>/i);
      const qipuDate = dateMatch ? dateMatch[1]!.trim().substring(0, 10) : "";

      // 日期过滤
      if (date && qipuDate !== date) continue;

      links.push({
        title,
        url: linkUrl,
        date: qipuDate,
      });
    }

    return links;
  }

  /**
   * 下载公开棋谱 SGF
   * 新版H5分享链接通过API获取：
   * https://h5.foxwq.com/yehunewshare/?chessid=xxx
   * -> 调用 FoxwqChessProvider.fetchSGF(chessid)
   */
  async fetchPublicQipuSgf(url: string): Promise<PublicQipuDetail> {
    // 从URL提取chessid
    const chessid = this.extractChessId(url);
    if (!chessid) {
      throw new Error("无法从URL中提取棋谱ID");
    }

    // 调用API获取SGF
    const sgf = await this.chessProvider.fetchSGF(chessid);

    // 从SGF中提取元数据
    const titleMatch = sgf.match(/GN\[([^\]]+)\]/);
    const dateMatch = sgf.match(/DT\[([^\]]+)\]/);

    return {
      sgf,
      title: titleMatch ? titleMatch[1]! : "未知",
      date: dateMatch ? dateMatch[1]! : "",
    };
  }

  /**
   * 从URL中提取chessid
   */
  private extractChessId(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const chessid = urlObj.searchParams.get("chessid");
      return chessid;
    } catch {
      // URL解析失败，尝试正则匹配
      const match = url.match(/chessid=([a-zA-Z0-9]+)/);
      return match && match[1] ? match[1] : null;
    }
  }
}
