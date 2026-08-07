/**
 * ReconnectManager 单元测试
 */

import { ReconnectManager } from '../ReconnectManager';

describe('ReconnectManager', () => {
  let manager: ReconnectManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new ReconnectManager(3, 1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('attempt', () => {
    it('should attempt reconnection', () => {
      const callback = jest.fn();
      const result = manager.attempt(callback);

      expect(result).toBe(true);
      expect(manager.getAttempts()).toBe(1);

      jest.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should not exceed max attempts', () => {
      const callback = jest.fn();

      manager.attempt(callback);
      manager.attempt(callback);
      manager.attempt(callback);

      expect(manager.isMaxAttempts()).toBe(true);

      const result = manager.attempt(callback);
      expect(result).toBe(false);
    });

    it('should call callback after delay', () => {
      const callback = jest.fn();
      manager.attempt(callback);

      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('should reset attempt count', () => {
      const callback = jest.fn();

      manager.attempt(callback);
      manager.attempt(callback);
      expect(manager.getAttempts()).toBe(2);

      manager.reset();
      expect(manager.getAttempts()).toBe(0);
      expect(manager.isMaxAttempts()).toBe(false);
    });
  });

  describe('getAttempts', () => {
    it('should return current attempt count', () => {
      const callback = jest.fn();

      expect(manager.getAttempts()).toBe(0);

      manager.attempt(callback);
      expect(manager.getAttempts()).toBe(1);

      manager.attempt(callback);
      expect(manager.getAttempts()).toBe(2);
    });
  });

  describe('isMaxAttempts', () => {
    it('should return true when max attempts reached', () => {
      const callback = jest.fn();

      expect(manager.isMaxAttempts()).toBe(false);

      manager.attempt(callback);
      manager.attempt(callback);
      manager.attempt(callback);

      expect(manager.isMaxAttempts()).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should use default values when not specified', () => {
      const defaultManager = new ReconnectManager();
      const callback = jest.fn();

      // 默认最大重连次数是 5
      defaultManager.attempt(callback);
      defaultManager.attempt(callback);
      defaultManager.attempt(callback);
      defaultManager.attempt(callback);
      defaultManager.attempt(callback);

      expect(defaultManager.isMaxAttempts()).toBe(true);
    });
  });
});
