/**
 * DataChannelManager 单元测试
 */

import { DataChannelManager } from '../DataChannelManager';

describe('DataChannelManager', () => {
  let manager: DataChannelManager;
  let mockChannel: RTCDataChannel;

  beforeEach(() => {
    manager = new DataChannelManager();

    // Mock DataChannel
    mockChannel = {
      readyState: 'open',
      send: jest.fn(),
      close: jest.fn(),
      onmessage: null,
      onopen: null,
      onclose: null,
      onerror: null
    } as unknown as RTCDataChannel;
  });

  afterEach(() => {
    manager.close();
  });

  describe('attach', () => {
    it('should attach DataChannel', () => {
      manager.attach(mockChannel);
      expect(manager.isOpen).toBe(true);
    });

    it('should setup event handlers', () => {
      manager.attach(mockChannel);

      expect(mockChannel.onmessage).not.toBeNull();
      expect(mockChannel.onopen).not.toBeNull();
      expect(mockChannel.onclose).not.toBeNull();
      expect(mockChannel.onerror).not.toBeNull();
    });
  });

  describe('send', () => {
    it('should send data through channel', () => {
      manager.attach(mockChannel);
      manager.send('test data');

      expect(mockChannel.send).toHaveBeenCalledWith('test data');
    });

    it('should throw error when channel not attached', () => {
      expect(() => manager.send('test')).toThrow('DataChannel not attached');
    });

    it('should throw error when channel is not open', () => {
      mockChannel.readyState = 'closed';
      manager.attach(mockChannel);

      expect(() => manager.send('test')).toThrow('DataChannel is not open');
    });
  });

  describe('close', () => {
    it('should close channel', () => {
      manager.attach(mockChannel);
      manager.close();

      expect(mockChannel.close).toHaveBeenCalled();
    });

    it('should not throw when closing without channel', () => {
      expect(() => manager.close()).not.toThrow();
    });
  });

  describe('readyState', () => {
    it('should return channel state', () => {
      manager.attach(mockChannel);
      expect(manager.readyState).toBe('open');

      mockChannel.readyState = 'closed';
      expect(manager.readyState).toBe('closed');
    });

    it('should return closed when no channel attached', () => {
      expect(manager.readyState).toBe('closed');
    });
  });

  describe('isOpen', () => {
    it('should return true when channel is open', () => {
      manager.attach(mockChannel);
      expect(manager.isOpen).toBe(true);
    });

    it('should return false when channel is not open', () => {
      mockChannel.readyState = 'closed';
      manager.attach(mockChannel);
      expect(manager.isOpen).toBe(false);
    });

    it('should return false when no channel attached', () => {
      expect(manager.isOpen).toBe(false);
    });
  });

  describe('callbacks', () => {
    it('should call onData callback when receiving message', () => {
      const callback = jest.fn();
      manager.setCallbacks({ onData: callback });
      manager.attach(mockChannel);

      // Simulate message event
      const event = { data: 'test message' };
      mockChannel.onmessage?.(event as MessageEvent);

      expect(callback).toHaveBeenCalledWith('test message');
    });

    it('should call onOpen callback when channel opens', () => {
      const callback = jest.fn();
      manager.setCallbacks({ onOpen: callback });
      manager.attach(mockChannel);

      mockChannel.onopen?.();

      expect(callback).toHaveBeenCalled();
    });

    it('should call onClose callback when channel closes', () => {
      const callback = jest.fn();
      manager.setCallbacks({ onClose: callback });
      manager.attach(mockChannel);

      mockChannel.onclose?.();

      expect(callback).toHaveBeenCalled();
    });

    it('should call onError callback when error occurs', () => {
      const callback = jest.fn();
      manager.setCallbacks({ onError: callback });
      manager.attach(mockChannel);

      mockChannel.onerror?.({} as Event);

      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
