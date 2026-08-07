/**
 * @fileoverview HTML 解析器
 * @description 从云比赛网 HTML 页面解析分组信息（赛事服务）
 */

import { HtmlParserBase } from '../../infrastructure/utils/html';
import type { Group } from './types';

/**
 * 云比赛网 HTML 解析器
 */
class EventHtmlParser extends HtmlParserBase {
  /**
   * 解析 HTML 中的分组信息
   * @param html - HTML 内容
   * @returns 分组列表
   */
  parseGroupsFromHtml(html: string): Group[] {
    const groups: Group[] = [];
    const seen = new Set<number>();

    // 格式1: data-groupid="..." data-groupname="..."
    const pattern = /data-groupid="(\d+)"[^>]*data-groupname="([^"]+)"/g;
    const matches = this.matchAll(html, pattern);

    for (const match of matches) {
      const groupId = match[1];
      const groupName = match[2];
      if (groupId && groupName) {
        const id = Number(groupId);
        if (!seen.has(id)) {
          seen.add(id);
          groups.push({
            id,
            name: groupName.trim(),
            players: null,
          });
        }
      }
    }

    return groups;
  }

  /**
   * 从比赛详情 HTML 提取分组信息
   * @param eventId - 比赛ID
   * @param html - HTML 内容
   * @returns 分组列表
   */
  extractGroupsFromHtml(eventId: number, html: string): Group[] {
    let groups = this.parseGroupsFromHtml(html);

    // 如果没有解析到分组，尝试备用模式
    if (groups.length === 0) {
      const altPattern = /<li[^>]*data-groupname="([^"]+)"[^>]*>[^<]*<a[^>]*data-groupid="(\d+)"/g;
      const seen = new Set<number>();
      const matches = this.matchAll(html, altPattern);

      for (const match of matches) {
        const groupId = match[2];
        const groupName = match[1];
        if (groupId && groupName) {
          const id = Number(groupId);
          if (!seen.has(id)) {
            seen.add(id);
            groups.push({
              id,
              name: groupName.trim(),
              players: null,
            });
          }
        }
      }
    }

    return groups;
  }
}

// 导出单例和便捷函数
const parser = new EventHtmlParser();

export const parseGroupsFromHtml = (html: string): Group[] =>
  parser.parseGroupsFromHtml(html);

export const extractGroupsFromHtml = (eventId: number, html: string): Group[] =>
  parser.extractGroupsFromHtml(eventId, html);

export { EventHtmlParser };
