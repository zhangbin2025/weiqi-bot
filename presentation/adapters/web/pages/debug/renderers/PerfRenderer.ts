/**
 * 性能渲染器
 * @module presentation/adapters/web/pages/debug/renderers/PerfRenderer
 */
import type { MemoryInfo } from '@services/debug/types';
import { formatSize } from '../utils/format';
/**
 * 性能渲染器
 */
export class PerfRenderer {
  /**
   * 渲染性能信息
   */
  render(memory: MemoryInfo): string {
    return `
      <div class="glass-card" style="padding: 12px;">
        <h3 style="margin-bottom: 12px;">内存信息</h3>
        <div style="margin-bottom: 8px;">
          <strong>最大内存：</strong>${formatSize(memory.max)}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>总内存：</strong>${formatSize(memory.total)}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>已用：</strong>${formatSize(memory.used)}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>空闲：</strong>${formatSize(memory.free)}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>使用率：</strong>${memory.usagePercent}%
        </div>
        <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 20px; overflow: hidden;">
          <div style="background: linear-gradient(90deg, #4CAF50, #FFC107, #F44336); height: 100%; width: ${memory.usagePercent}%;"></div>
        </div>
      </div>
    `;
  }
}
