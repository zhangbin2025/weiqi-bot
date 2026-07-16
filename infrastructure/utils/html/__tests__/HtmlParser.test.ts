/**
 * HtmlParserBase 外部接口测试
 */

import { describe, it, expect } from 'vitest';
import { HtmlParserBase } from '../HtmlParser';

describe('HtmlParserBase 外部接口', () => {
  const parser = new HtmlParserBase();

  describe('parseAttrs()', () => {
    it('should parse HTML attributes', () => {
      const result = parser.parseAttrs('name="value" id="123"');
      expect(result).toEqual({ name: 'value', id: '123' });
    });

    it('should handle single quotes', () => {
      const result = parser.parseAttrs("name='value'");
      expect(result).toEqual({ name: 'value' });
    });

    it('should return empty object for empty string', () => {
      expect(parser.parseAttrs('')).toEqual({});
    });
  });

  describe('extractDataAttrs()', () => {
    it('should extract data attributes', () => {
      const html = '<div data-id="123" data-name="test">';
      const result = parser.extractDataAttrs(html, ['id', 'name']);
      expect(result).toEqual({ id: '123', name: 'test' });
    });

    it('should return empty for missing attributes', () => {
      const result = parser.extractDataAttrs('<div>', ['id']);
      expect(result).toEqual({});
    });
  });

  describe('matchAll()', () => {
    it('should return all matches', () => {
      const result = parser.matchAll('a1 b2 c3', /([a-z])(\d)/g);
      expect(result.length).toBe(3);
    });

    it('should return empty array for no matches', () => {
      const result = parser.matchAll('abc', /\d/g);
      expect(result).toEqual([]);
    });
  });

  describe('matchFirst()', () => {
    it('should return first match', () => {
      const result = parser.matchFirst('a1 b2', /([a-z])(\d)/);
      expect(result);
      expect(result[0]).toBe('a1');
    });

    it('should return null for no match', () => {
      expect(parser.matchFirst('abc', /\d/)).toBe(null);
    });
  });

  describe('extractTagContent()', () => {
    it('should extract tag content', () => {
      const html = '<title>Title</title><p>Content</p>';
      const result = parser.extractTagContent(html, 'title');
      expect(result).toEqual(['Title']);
    });

    it('should return empty array for missing tag', () => {
      expect(parser.extractTagContent('<div>text</div>', 'span')).toEqual([]);
    });
  });

  describe('parseSelfClosingTag()', () => {
    it('should parse self-closing tags', () => {
      const html = '<input type="text" name="field" />';
      const result = parser.parseSelfClosingTag(html, 'input');
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('text');
    });

    it('should return empty array for missing tag', () => {
      expect(parser.parseSelfClosingTag('<div></div>', 'img')).toEqual([]);
    });
  });
});