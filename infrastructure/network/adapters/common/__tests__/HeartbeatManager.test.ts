/**
 * HeartbeatManager 单元测试
 */

import { HeartbeatManager } from '../HeartbeatManager';

describe('HeartbeatManager', () => {
  let manager: HeartbeatManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new HeartbeatManager(1000);
  });

  afterEach(() => {
    manager.stop();
    jest.useRealTimers();
  });

  describe('start', () => {
    it('should start heartbeat and call callback periodically', () => {
      const callback = jest.fn();
      manager.start(callback);

      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should stop previous heartbeat when starting new one', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      manager.start(callback1);
      jest.advanceTimersByTime(1000);
      expect(callback1).toHaveBeenCalledTimes(1);

      manager.start(callback2);
      jest.advanceTimersByTime(1000);
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('should stop heartbeat', () => {
      const callback = jest.fn();
      manager.start(callback);

      jest.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      manager.stop();
      jest.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should not throw when stopping without starting', () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });

  describe('constructor', () => {
    it('should use default interval when not specified', () => {
      const defaultManager = new HeartbeatManager();
      const callback = jest.fn();
      defaultManager.start(callback);

      jest.advanceTimersByTime(30000);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
