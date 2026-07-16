/**
 * FunctionRegistry 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionRegistry } from '../FunctionRegistry';
import type { AIFunction, ExecutionContext } from '../types';
import type { ILogger } from '../../../infrastructure/logger/types';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  withContext: vi.fn().mockReturnThis(),
  setLevel: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  getConfig: vi.fn().mockReturnValue({}),
  name: 'test-logger',
});

const logger = createMockLogger();
const context: ExecutionContext = { userId: 'test-user', logger };
describe('FunctionRegistry', () => {
  let registry: FunctionRegistry;
  const mockFunction: AIFunction = {
    name: 'test_function',
    description: '测试函数',
    parameters: {
      param1: { type: 'string', description: '参数1', required: true },
      param2: { type: 'number', description: '参数2', default: 10 },
    },
    execute: vi.fn().mockResolvedValue({ result: 'success' }),
  };
  const mockLongRunningFunction: AIFunction = {
    name: 'long_task',
    description: '长时间任务',
    parameters: {},
    execute: vi.fn().mockResolvedValue({ progress: 100 }),
    isLongRunning: true,
  };
  beforeEach(() => {
    registry = new FunctionRegistry(logger);
    vi.clearAllMocks();
  });
  describe('register - 注册函数', () => {
    it('应成功注册函数', () => {
      registry.register(mockFunction);
      expect(registry.has('test_function')).toBe(true);
    });
    it('重复注册应覆盖并调用 logger.warn', () => {
      registry.register(mockFunction);
      registry.register(mockFunction);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );
    });
    it('批量注册应注册所有函数', () => {
      registry.registerAll([mockFunction, mockLongRunningFunction]);
      expect(registry.has('test_function')).toBe(true);
      expect(registry.has('long_task')).toBe(true);
    });
  });
  describe('get - 获取函数', () => {
    it('应返回已注册的函数', () => {
      registry.register(mockFunction);
      const fn = registry.get('test_function');
      expect(fn).toBeDefined();
      expect(fn?.name).toBe('test_function');
    });
    it('未注册函数应返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });
  describe('has - 检查函数是否存在', () => {
    it('已注册应返回 true', () => {
      registry.register(mockFunction);
      expect(registry.has('test_function')).toBe(true);
    });
    it('未注册应返回 false', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });
  describe('execute - 执行函数', () => {
    it('应执行已注册的函数', async () => {
      registry.register(mockFunction);
      const result = await registry.execute('test_function', { param1: 'value' });
      expect(result).toEqual({ result: 'success' });
    });
    it('应传递执行上下文', async () => {
      registry.register(mockFunction);
      await registry.execute('test_function', { param1: 'value' }, context);
      expect(mockFunction.execute).toHaveBeenCalledWith({ param1: 'value' }, context);
    });
    it('函数不存在应抛出错误', async () => {
      await expect(registry.execute('nonexistent', {})).rejects.toThrow('Function not found');
    });
  });
  describe('getDefinitions - 获取函数定义', () => {
    it('应返回所有函数的定义', () => {
      registry.registerAll([mockFunction, mockLongRunningFunction]);
      const definitions = registry.getDefinitions();
      expect(definitions).toHaveLength(2);
    });
    it('空注册表应返回空数组', () => {
      expect(registry.getDefinitions()).toHaveLength(0);
    });
  });
  describe('isLongRunning', () => {
    it('长时任务应返回 true', () => {
      registry.register(mockLongRunningFunction);
      expect(registry.isLongRunning('long_task')).toBe(true);
    });
    it('即时任务应返回 false', () => {
      registry.register(mockFunction);
      expect(registry.isLongRunning('test_function')).toBe(false);
    });
    it('未注册函数应返回 false', () => {
      expect(registry.isLongRunning('nonexistent')).toBe(false);
    });
  });
  describe('unregister - 取消注册', () => {
    it('应取消注册并返回 true', () => {
      registry.register(mockFunction);
      expect(registry.unregister('test_function')).toBe(true);
      expect(registry.has('test_function')).toBe(false);
    });
    it('取消不存在的函数应返回 false', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });
  describe('clear - 清空注册表', () => {
    it('应清空所有已注册的函数', () => {
      registry.registerAll([mockFunction, mockLongRunningFunction]);
      registry.clear();
      expect(registry.getFunctionNames()).toHaveLength(0);
    });
  });
  describe('函数执行错误处理', () => {
    it('执行抛出错误应向上传递', async () => {
      const errorFunction: AIFunction = {
        name: 'error_function',
        description: '会报错的函数',
        parameters: {},
        execute: vi.fn().mockRejectedValue(new Error('执行失败')),
      };
      registry.register(errorFunction);
      await expect(registry.execute('error_function', {})).rejects.toThrow('执行失败');
    });
  });
});