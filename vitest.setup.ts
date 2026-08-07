/**
 * Vitest setup file
 * Provides Jest compatibility aliases for vitest
 */

import { vi } from 'vitest';


// 静默测试期间的日志输出（使用 spy mock，vitest 不会捕获）
const originalConsole = { ...console };
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'debug').mockImplementation(() => {});
vi.spyOn(console, 'trace').mockImplementation(() => {});

// 导出原始 console 供需要验证日志的测试使用
export { originalConsole };

// Provide Jest compatibility - map jest to vi
(globalThis as unknown as Record<string, unknown>).jest = vi;

// Jest timer mocks
jest.useFakeTimers = vi.useFakeTimers;
jest.useRealTimers = vi.useRealTimers;
jest.advanceTimersByTime = vi.advanceTimersByTime;
jest.runAllTimers = vi.runAllTimers;
jest.runAllTimersAsync = vi.runAllTimersAsync;
jest.runOnlyPendingTimers = vi.runOnlyPendingTimers;
jest.runOnlyPendingTimersAsync = vi.runOnlyPendingTimersAsync;
jest.advanceTimersToNextTimer = vi.advanceTimersToNextTimer;
jest.advanceTimersToNextTimerAsync = vi.advanceTimersToNextTimerAsync;
jest.getTimerCount = vi.getTimerCount;
jest.setSystemTime = vi.setSystemTimers;
jest.getRealSystemTime = vi.getRealSystemTime;

// Jest mock functions
jest.fn = vi.fn;
jest.spyOn = vi.spyOn;
jest.mock = vi.mock;
jest.unmock = vi.unmock;
jest.doMock = vi.doMock;
jest.dontMock = vi.dontMock;
jest.resetModules = vi.resetModules;
jest.isolateModules = vi.isolateModules;

// Jest mock implementations
jest.clearAllMocks = vi.clearAllMocks;
jest.resetAllMocks = vi.resetAllMocks;
jest.restoreAllMocks = vi.restoreAllMocks;
jest.mocked = vi.mocked;