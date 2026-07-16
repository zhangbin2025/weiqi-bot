/**
 * WebClipboard 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebClipboard } from '../WebClipboard';

describe('WebClipboard', () => {
  let clipboard: WebClipboard;

  beforeEach(() => {
    clipboard = new WebClipboard();
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: vi.fn(),
        writeText: vi.fn(),
      },
    });
  });

  describe('isAvailable', () => {
    it('should return true when clipboard API is available', () => {
      expect(clipboard.isAvailable()).toBe(true);
    });

    it('should return false when navigator is undefined', () => {
      vi.stubGlobal('navigator', undefined);
      expect(clipboard.isAvailable()).toBe(false);
    });
  });

  describe('readText', () => {
    it('should return text from clipboard', async () => {
      const mockText = 'https://example.com/sgf';
      vi.mocked(navigator.clipboard.readText).mockResolvedValue(mockText);
      
      const result = await clipboard.readText();
      expect(result).toBe(mockText);
    });

    it('should return null on read error', async () => {
      vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('Permission denied'));
      
      const result = await clipboard.readText();
      expect(result).toBeNull();
    });
  });

  describe('writeText', () => {
    it('should write text to clipboard', async () => {
      const text = 'test content';
      await clipboard.writeText(text);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
    });
  });
});
