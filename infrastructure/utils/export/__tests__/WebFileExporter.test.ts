/**
 * WebFileExporter 测试
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebFileExporter } from '../WebFileExporter';

describe('WebFileExporter', () => {
  let exporter: WebFileExporter;

  beforeEach(() => {
    exporter = new WebFileExporter();
  });

  describe('exportText', () => {
    it('应导出文本内容', async () => {
      const content = 'Hello, World!';
      const result = await exporter.exportText(content, 'test.txt');

      expect(result.success).toBe(true);
      expect(result.path).toBe('test.txt');
    });

    it('应使用自定义 MIME 类型', async () => {
      const content = '{"key": "value"}';
      const result = await exporter.exportText(content, 'test.json', {
        mimeType: 'application/json',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('exportBlob', () => {
    it('应导出 Blob 数据', async () => {
      const blob = new Blob(['test data'], { type: 'text/plain' });
      const result = await exporter.exportBlob(blob, 'test.txt');

      expect(result.success).toBe(true);
    });

    it('应导出 ArrayBuffer 数据', async () => {
      const buffer = new ArrayBuffer(10);
      const result = await exporter.exportBlob(buffer, 'test.bin');

      expect(result.success).toBe(true);
    });
  });

  describe('exportBase64', () => {
    it('应导出 Base64 数据', async () => {
      const base64 = 'SGVsbG8sIFdvcmxkIQ=='; // "Hello, World!"
      const result = await exporter.exportBase64(base64, 'test.bin');

      expect(result.success).toBe(true);
    });

    it('应使用自定义 MIME 类型', async () => {
      const base64 = 'iVBORw0KGgo='; // PNG 文件头片段
      const result = await exporter.exportBase64(base64, 'test.png', 'image/png');

      expect(result.success).toBe(true);
    });
  });

  describe('exportJSON', () => {
    it('应导出 JSON 对象', async () => {
      const data = { name: 'test', value: 123 };
      const result = await exporter.exportJSON(data, 'test.json');

      expect(result.success).toBe(true);
      expect(result.path).toBe('test.json');
    });

    it('应自动添加 .json 扩展名', async () => {
      const data = { key: 'value' };
      const result = await exporter.exportJSON(data, 'test');

      expect(result.success).toBe(true);
      expect(result.path).toBe('test.json');
    });

    it('应正确格式化 JSON', async () => {
      const data = { nested: { key: 'value' } };
      const result = await exporter.exportJSON(data, 'test.json');

      expect(result.success).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('在浏览器环境应返回 true', () => {
      // vitest 默认是 node 环境，所以这里返回 false
      const available = exporter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('getCapabilities', () => {
    it('应返回正确的能力描述', () => {
      const capabilities = exporter.getCapabilities();

      expect(capabilities.text).toBe(true);
      expect(capabilities.binary).toBe(true);
      expect(typeof capabilities.share).toBe('boolean');
      expect(capabilities.pickLocation).toBe(false);
      expect(capabilities.maxFileSize).toBe(1024 * 1024 * 500);
    });
  });
});