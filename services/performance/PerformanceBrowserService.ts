/**
 * 性能浏览服务
 * @module services/performance/PerformanceBrowserService
 * 
 * 提供性能数据的格式化和展示逻辑，作为命令层的接口
 */

import type { IDebugService } from '../debug/IDebugService';
import type { IPerformanceBrowserService } from './IPerformanceBrowserService';
import type { PerformanceOverview, MemoryDisplayInfo, SystemDisplayInfo } from './types';

/**
 * 性能浏览服务配置
 */
export interface PerformanceBrowserConfig {
  debugService: IDebugService;
}

/**
 * 性能浏览服务
 * 
 * 提供性能数据的浏览、格式化和展示功能
 */
export class PerformanceBrowserService implements IPerformanceBrowserService {
  constructor(private config: PerformanceBrowserConfig) {}

  /**
   * 显示性能概览
   */
  async showOverview(): Promise<string> {
    try {
      const memoryInfo = await this.config.debugService.getMemoryInfo();
      const appInfo = await this.config.debugService.getAppInfo();
      
      // 格式化内存信息
      const memory: MemoryDisplayInfo = {
        max: memoryInfo.max,
        maxFormatted: this.formatSize(memoryInfo.max),
        total: memoryInfo.total,
        totalFormatted: this.formatSize(memoryInfo.total),
        used: memoryInfo.used,
        usedFormatted: this.formatSize(memoryInfo.used),
        free: memoryInfo.free,
        freeFormatted: this.formatSize(memoryInfo.free),
        usagePercent: memoryInfo.usagePercent,
      };
      
      // 格式化系统信息
      const system: SystemDisplayInfo = {
        device: appInfo.model || '未知设备',
        os: appInfo.os || '未知系统',
        appVersion: appInfo.version || '未知版本',
        platform: appInfo.platform || 'web',
      };
      
      // 构建 Markdown 文本
      return this.formatOverview({ memory, system });
    } catch (error) {
      console.error('[PerformanceBrowser] Failed to get performance overview:', error);
      return `❌ 查询性能信息失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 格式化性能概览为 Markdown
   */
  private formatOverview(overview: PerformanceOverview): string {
    const { memory, system } = overview;
    
    let text = '## 📊 性能概览\n\n';
    
    // 内存使用表格
    text += '### 内存使用\n\n';
    text += '| 指标 | 数值 |\n';
    text += '|------|------|\n';
    text += `| 最大可用 | ${memory.maxFormatted} |\n`;
    text += `| 总内存 | ${memory.totalFormatted} |\n`;
    text += `| 已使用 | ${memory.usedFormatted} |\n`;
    text += `| 空闲 | ${memory.freeFormatted} |\n`;
    text += `| 使用率 | ${memory.usagePercent}% |\n`;
    
    text += '\n### 系统信息\n\n';
    text += `- **设备**: ${system.device}\n`;
    text += `- **系统**: ${system.os}\n`;
    text += `- **App版本**: ${system.appVersion}\n`;
    
    return text;
  }

  /**
   * 格式化大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
