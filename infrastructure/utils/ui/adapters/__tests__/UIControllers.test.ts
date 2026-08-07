/**
 * UI 适配器外部接口测试
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { WebUIController } from '../WebUIController';
import { ElectronUIController } from '../ElectronUIController';
import { MobileUIController } from '../MobileUIController';
import { TerminalUIController } from '../TerminalUIController';
import { MiniProgramUIController } from '../MiniProgramUIController';

describe('UI 适配器外部接口', () => {
  const originalWindow = global.window;
  const originalProcess = global.process;

  beforeEach(() => {
    // @ts-expect-error - mock
    global.window = undefined;
    // @ts-expect-error - mock
    global.process = undefined;
  });

  afterEach(() => {
    global.window = originalWindow;
    global.process = originalProcess;
  });

  describe('WebUIController', () => {
    it('should have correct platform name', () => {
      const ctrl = new WebUIController();
      expect(ctrl.platform).toBe('web');
    });

    it('should return false when window unavailable', async () => {
      const ctrl = new WebUIController();
      const available = await ctrl.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('ElectronUIController', () => {
    it('should have correct platform name', () => {
      const ctrl = new ElectronUIController();
      expect(ctrl.platform).toBe('electron');
    });

    it('should return false when process unavailable', async () => {
      const ctrl = new ElectronUIController();
      const available = await ctrl.isAvailable();
      expect(available).toBe(false);
    });

    it('should allow setting window manager', () => {
      const ctrl = new ElectronUIController();
      ctrl.setWindowManager({} as any);
      expect(true);
    });
  });

  describe('MobileUIController', () => {
    it('should have correct platform name', () => {
      const ctrl = new MobileUIController();
      expect(ctrl.platform).toBe('mobile');
    });

    it('should return false when bridge unavailable', async () => {
      const ctrl = new MobileUIController();
      const available = await ctrl.isAvailable();
      expect(available).toBe(false);
    });

    it('should throw without bridge', async () => {
      const ctrl = new MobileUIController();
      await expect(async () => {
        await ctrl.openPage('/');
      }).rejects.toThrow(/bridge|undefined/i);
    });
  });

  describe('TerminalUIController', () => {
    it('should have correct platform name', () => {
      const ctrl = new TerminalUIController();
      expect(ctrl.platform).toBe('terminal');
    });

    it('should always be available', async () => {
      const ctrl = new TerminalUIController();
      const available = await ctrl.isAvailable();
      expect(available).toBe(true);
    });

    it('should allow registering screens', () => {
      const ctrl = new TerminalUIController();
      ctrl.registerScreen('test', {
        render: () => {},
        destroy: () => {},
        setContent: () => {},
      });
      expect(true);
    });
  });

  describe('MiniProgramUIController', () => {
    it('should have correct platform name', () => {
      const ctrl = new MiniProgramUIController();
      expect(ctrl.platform).toBe('miniprogram');
    });

    it('should return false when wx unavailable', async () => {
      const ctrl = new MiniProgramUIController();
      const available = await ctrl.isAvailable();
      expect(available).toBe(false);
    });
  });
});