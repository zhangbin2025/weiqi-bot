import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationManager } from '../NotificationManager';
import { TerminalNotifier } from '../adapters/TerminalNotifier';
import type { INotificationProvider, Notification } from '../types';

describe('NotificationManager', () => {
  let manager: NotificationManager;
  let mockProvider: INotificationProvider;

  beforeEach(() => {
    // 创建模拟提供者
    mockProvider = {
      platform: 'terminal',
      isAvailable: vi.fn().mockResolvedValue(true),
      hasPermission: vi.fn().mockResolvedValue(true),
      requestPermission: vi.fn().mockResolvedValue(true),
      notify: vi.fn().mockResolvedValue(undefined),
    };

    manager = new NotificationManager(mockProvider);
  });

  describe('构造函数', () => {
    it('应该使用提供的适配器', () => {
      expect(manager.getPlatform()).toBe('terminal');
    });

    it('应该在没有提供适配器时自动检测', () => {
      const defaultManager = new NotificationManager();
      // 在测试环境中应该返回 TerminalNotifier
      expect(defaultManager.getPlatform()).toBe('terminal');
    });
  });

  describe('权限管理', () => {
    it('应该检查权限', async () => {
      const hasPermission = await manager.hasPermission();
      expect(hasPermission).toBe(true);
      expect(mockProvider.hasPermission).toHaveBeenCalled();
    });

    it('应该请求权限', async () => {
      const granted = await manager.requestPermission();
      expect(granted).toBe(true);
      expect(mockProvider.requestPermission).toHaveBeenCalled();
    });
  });

  describe('发送通知', () => {
    it('应该发送自定义通知', async () => {
      const notification: Notification = {
        id: 'test-1',
        title: '测试通知',
        body: '这是测试内容',
        type: 'info',
      };

      await manager.notify(notification);

      expect(mockProvider.notify).toHaveBeenCalledWith(notification);
    });

    it('应该在发送前自动请求权限', async () => {
      const providerWithoutPermission: INotificationProvider = {
        ...mockProvider,
        hasPermission: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockResolvedValue(true),
      };

      manager = new NotificationManager(providerWithoutPermission);

      await manager.notify({
        id: 'test-1',
        title: '测试',
        body: '内容',
        type: 'info',
      });

      expect(providerWithoutPermission.hasPermission).toHaveBeenCalled();
      expect(providerWithoutPermission.requestPermission).toHaveBeenCalled();
      expect(providerWithoutPermission.notify).toHaveBeenCalled();
    });

    it('应该在权限被拒绝时抛出错误', async () => {
      const providerDenied: INotificationProvider = {
        ...mockProvider,
        hasPermission: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockResolvedValue(false),
      };

      manager = new NotificationManager(providerDenied);

      await expect(manager.notify({
        id: 'test-1',
        title: '测试',
        body: '内容',
        type: 'info',
      })).rejects.toThrow('Notification permission denied');
    });
  });

  describe('快捷方法', () => {
    it('应该发送 info 通知', async () => {
      await manager.info('信息标题', '信息内容');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '信息标题',
          body: '信息内容',
          type: 'info',
        })
      );
    });

    it('应该发送 success 通知', async () => {
      await manager.success('成功标题', '成功内容');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '成功标题',
          body: '成功内容',
          type: 'success',
        })
      );
    });

    it('应该发送 warning 通知', async () => {
      await manager.warning('警告标题', '警告内容');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '警告标题',
          body: '警告内容',
          type: 'warning',
        })
      );
    });

    it('应该发送 error 通知', async () => {
      await manager.error('错误标题', '错误内容');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '错误标题',
          body: '错误内容',
          type: 'error',
        })
      );
    });

    it('应该发送 progress 通知', async () => {
      await manager.progress('task-1', 50, '处理中...');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
          body: '处理中...',
          type: 'progress',
          progress: 50,
        })
      );
    });

    it('应该限制 progress 在 0-100 范围内', async () => {
      await manager.progress('task-1', 150, '超出范围');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 100,
        })
      );

      await manager.progress('task-2', -10, '负数');

      expect(mockProvider.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 0,
        })
      );
    });
  });
});

describe('TerminalNotifier', () => {
  let notifier: TerminalNotifier;

  beforeEach(() => {
    notifier = new TerminalNotifier();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('应该始终可用', async () => {
    expect(await notifier.isAvailable()).toBe(true);
  });

  it('应该始终有权限', async () => {
    expect(await notifier.hasPermission()).toBe(true);
  });

  it('应该输出通知到控制台', async () => {
    await notifier.notify({
      id: '1',
      title: '测试标题',
      body: '测试内容',
      type: 'info',
    });

    expect(console.log).toHaveBeenCalled();
  });

  it('应该根据类型使用不同颜色', async () => {
    await notifier.notify({
      id: '1',
      title: '成功',
      body: '内容',
      type: 'success',
    });

    const calls = vi.mocked(console.log).mock.calls;
    expect(calls[0]?.[0]).toContain('✓');
    expect(calls[0]?.[0]).toContain('\x1b[32m'); // 绿色
  });

  it('应该显示进度条', async () => {
    await notifier.notify({
      id: '1',
      title: '进度',
      body: '处理中',
      type: 'progress',
      progress: 50,
    });

    const calls = vi.mocked(console.log).mock.calls;
    const progressCall = calls.find(call => 
      typeof call[0] === 'string' && call[0].includes('50%')
    );
    expect(progressCall).toBeDefined();
  });
});
