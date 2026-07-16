/**
 * Notification 适配器外部接口测试
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { BrowserNotifier } from '../BrowserNotifier';
import { ElectronNotifier } from '../ElectronNotifier';
import { MobileNotifier } from '../MobileNotifier';
import { TerminalNotifier } from '../TerminalNotifier';
import { MiniProgramNotifier } from '../MiniProgramNotifier';

describe('Notification 适配器外部接口', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // @ts-expect-error - mock
    global.window = undefined;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe('BrowserNotifier', () => {
    it('should have correct platform name', () => {
      const notifier = new BrowserNotifier();
      expect(notifier.platform).toBe('browser');
    });

    it('should return false when window unavailable', async () => {
      const notifier = new BrowserNotifier();
      const available = await notifier.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false for permission without window', async () => {
      const notifier = new BrowserNotifier();
      const hasPerm = await notifier.hasPermission();
      expect(hasPerm).toBe(false);
    });
  });

  describe('ElectronNotifier', () => {
    it('should have correct platform name', () => {
      const notifier = new ElectronNotifier();
      expect(notifier.platform).toBe('electron');
    });

    it('should return false when electron unavailable', async () => {
      const notifier = new ElectronNotifier();
      const available = await notifier.isAvailable();
      expect(available).toBe(false);
    });

    it('should throw when notify without electron', async () => {
      const notifier = new ElectronNotifier();
      await expect(async () => {
        await notifier.notify({ id: '1', title: 'test', body: 'test', type: 'info' });
      }).rejects.toThrow(/not available/);
    });
  });

  describe('MobileNotifier', () => {
    it('should have correct platform name', () => {
      const notifier = new MobileNotifier();
      expect(notifier.platform).toBe('mobile');
    });

    it('should return false when bridge unavailable', async () => {
      const notifier = new MobileNotifier();
      const available = await notifier.isAvailable();
      expect(available).toBe(false);
    });

    it('should throw when notify without bridge', async () => {
      const notifier = new MobileNotifier();
      await expect(async () => {
        await notifier.notify({ id: '1', title: 'test', body: 'test', type: 'info' });
      }).rejects.toThrow(/bridge/);
    });

    it('should allow setting bridge', () => {
      MobileNotifier.setBridge({
        showNotification: async () => {},
        checkPermission: async () => true,
        requestPermission: async () => true,
      });
      expect(true);
    });
  });

  describe('TerminalNotifier', () => {
    it('should have correct platform name', () => {
      const notifier = new TerminalNotifier();
      expect(notifier.platform).toBe('terminal');
    });

    it('should always be available', async () => {
      const notifier = new TerminalNotifier();
      const available = await notifier.isAvailable();
      expect(available).toBe(true);
    });

    it('should always have permission', async () => {
      const notifier = new TerminalNotifier();
      const hasPerm = await notifier.hasPermission();
      expect(hasPerm).toBe(true);
    });

    it('should notify without error', async () => {
      const notifier = new TerminalNotifier();
      await notifier.notify({ id: '1', title: 'Test', body: 'Message', type: 'success' });
      expect(true);
    });
  });

  describe('MiniProgramNotifier', () => {
    it('should have correct platform name', () => {
      const notifier = new MiniProgramNotifier();
      expect(notifier.platform).toBe('miniprogram');
    });

    it('should return false when wx unavailable', async () => {
      const notifier = new MiniProgramNotifier();
      const available = await notifier.isAvailable();
      expect(available).toBe(false);
    });

    it('should throw when notify without wx', async () => {
      const notifier = new MiniProgramNotifier();
      await expect(async () => {
        await notifier.notify({ id: '1', title: 'test', body: 'test', type: 'info' });
      }).rejects.toThrow(/not available/);
    });
  });
});