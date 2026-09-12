/**
 * @fileoverview 调试日志 RPC 处理器
 * @description 服务端处理器：接收远程 debug RPC 请求，委托给本地 DebugService 执行
 *
 * 支持的 RPC 方法：
 * - getLogs: 获取服务端日志
 * - getLogStats: 获取日志统计
 * - clearLogs: 清空服务端日志
 * - getStorageStats: 获取服务端存储信息
 * - getMemoryInfo: 获取服务端内存信息
 * - getAppInfo: 获取服务端 App 信息
 */

import type { IRpcHandler, TunnelService } from './types';
import type { IDebugService } from '../../services/debug/IDebugService';

/** Debug RPC 请求参数 */
interface DebugRpcParams {
  getLogs: { limit?: number };
  getLogStats: void;
  clearLogs: void;
  getStorageStats: void;
  getMemoryInfo: void;
  getAppInfo: void;
}

/** Debug RPC 方法名 */
type DebugMethod = keyof DebugRpcParams;

export class DebugRpcHandler implements IRpcHandler {
  readonly serviceName: TunnelService = 'debug';
  private debugService: IDebugService;

  constructor(debugService: IDebugService) {
    this.debugService = debugService;
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    const m = method as DebugMethod;

    switch (m) {
      case 'getLogs': {
        const { limit } = (params as { limit?: number }) || {};
        const logs = await this.debugService.getLogs(limit ? { limit } : undefined);
        return logs;
      }

      case 'getLogStats':
        return this.debugService.getLogStats();

      case 'clearLogs':
        await this.debugService.clearLogs();
        return undefined;

      case 'getStorageStats':
        return this.debugService.getStorageStats();

      case 'getMemoryInfo':
        return this.debugService.getMemoryInfo();

      case 'getAppInfo':
        return this.debugService.getAppInfo();

      default:
        throw new Error(`未知的 debug 方法: ${method}`);
    }
  }
}
