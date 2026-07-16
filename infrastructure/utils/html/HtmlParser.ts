/**
 * @fileoverview HTML 解析器基类
 * @description 提供通用的 HTML 解析能力，供各服务解析器继承使用
 */

import type { AttrMap, MatchResult } from './types';

/**
 * HTML 解析器基类
 *
 * 提供通用的 HTML/XML 解析能力：
 * - parseAttrs: 解析 XML/HTML 属性字符串
 * - extractDataAttrs: 提取 data-* 属性
 * - matchAll: 批量正则匹配
 */
export class HtmlParserBase {
  /**
   * 解析 XML/HTML 属性字符串
   * @param str - 属性字符串，如 `name="value" id='123'`
   * @returns 属性键值对
   * @example
   * ```ts
   * parseAttrs('name="张三" id=\'123\'')
   * // => { name: '张三', id: '123' }
   * ```
   */
  parseAttrs(str: string): AttrMap {
    const attrs: AttrMap = {};
    const pattern = /([^\s=]+)=['"]([^'"]*)['"]/g;
    let match;

    while ((match = pattern.exec(str)) !== null) {
      if (match[1] !== undefined && match[2] !== undefined) {
        attrs[match[1]] = match[2];
      }
    }

    return attrs;
  }

  /**
   * 提取 HTML 元素的 data-* 属性
   * @param html - HTML 内容
   * @param attrs - 要提取的属性名列表（不含 data- 前缀）
   * @returns 属性键值对
   * @example
   * ```ts
   * extractDataAttrs('<div data-id="123" data-name="test">', ['id', 'name'])
   * // => { id: '123', name: 'test' }
   * ```
   */
  extractDataAttrs(html: string, attrs: string[]): AttrMap {
    const result: AttrMap = {};

    for (const attr of attrs) {
      const pattern = new RegExp(`data-${attr}="([^"]*)"`, 'i');
      const match = html.match(pattern);
      if (match && match[1]) {
        result[attr] = match[1];
      }
    }

    return result;
  }

  /**
   * 批量正则匹配
   * @param html - HTML 内容
   * @param pattern - 正则表达式（需要包含 g 标志）
   * @returns 匹配结果数组
   * @example
   * ```ts
   * matchAll('a1 b2 c3', /([a-z])(\d)/g)
   * // => [['a1', 'a', '1'], ['b2', 'b', '2'], ['c3', 'c', '3']]
   * ```
   */
  matchAll(html: string, pattern: RegExp): MatchResult[] {
    const results: MatchResult[] = [];

    // 确保正则有全局标志
    if (!pattern.global) {
      pattern = new RegExp(pattern.source, pattern.flags + 'g');
    }

    let match;
    while ((match = pattern.exec(html)) !== null) {
      results.push(match);
    }

    return results;
  }

  /**
   * 提取第一个匹配结果
   * @param html - HTML 内容
   * @param pattern - 正则表达式
   * @returns 第一个匹配结果或 null
   */
  matchFirst(html: string, pattern: RegExp): MatchResult | null {
    const match = html.match(pattern);
    return match ? Array.from(match) : null;
  }

  /**
   * 提取 HTML 标签内容
   * @param html - HTML 内容
   * @param tagName - 标签名
   * @returns 标签内容数组
   */
  extractTagContent(html: string, tagName: string): string[] {
    const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'gi');
    return this.matchAll(html, pattern)
      .map(m => m[1])
      .filter((content): content is string => content !== undefined);
  }

  /**
   * 解析自闭合标签属性
   * @param html - HTML 内容
   * @param tagName - 标签名
   * @returns 属性数组
   */
  parseSelfClosingTag(html: string, tagName: string): AttrMap[] {
    const pattern = new RegExp(`<${tagName}\\s+([^>]+)\\s*/>`, 'gi');
    const results: AttrMap[] = [];

    const matches = this.matchAll(html, pattern);
    for (const match of matches) {
      if (match[1]) {
        results.push(this.parseAttrs(match[1]));
      }
    }

    return results;
  }
}
