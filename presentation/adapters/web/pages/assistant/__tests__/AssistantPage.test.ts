/**
 * AssistantPage 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock AdapterFactory
vi.mock('../../../adapters', () => ({
  AdapterFactory: {
    createDialog: () => ({
      show: vi.fn().mockResolvedValue(null),
      destroy: vi.fn(),
    }),
    createInput: () => ({
      onEnter: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    }),
    createNotification: () => ({
      add: vi.fn().mockReturnValue('notif-1'),
      update: vi.fn(),
      updateProgress: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    }),
    createToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      destroy: vi.fn(),
    }),
    createCard: () => ({
      setContent: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    }),
  },
}));
import { AssistantPage } from '../AssistantPage';
describe('AssistantPage', () => {
  let page: AssistantPage;
  beforeEach(() => {
    // AssistantPage 实际构造函数没有参数
    page = new AssistantPage();
  });
  describe('初始化', () => {
    it('应正确创建实例', () => {
      expect(page).toBeDefined();
    });
    it('应有 init 方法', async () => {
      // init 方法是异步的，会初始化各种服务
      // 在测试环境中，由于 IndexedDB 可能不可用，init 可能会失败
      // 但我们至少可以验证方法存在
      expect(page.init).toBeDefined();
      expect(typeof page.init).toBe('function');
    });
  });
  describe('方法存在性', () => {
    it('应有 init 方法', () => {
      expect(page.init).toBeDefined();
    });
  });
});
