/**
 * 存储渲染器
 * @module presentation/adapters/web/pages/debug/renderers/StorageRenderer
 */
import type { StorageStats } from '@services/debug/types';
/**
 * 存储渲染器
 */
export class StorageRenderer {
  /**
   * 渲染存储统计
   */
  render(stats: StorageStats): string {
    return `
      <div class="glass-card" style="padding: 12px;">
        <h3 style="margin-bottom: 12px;">存储统计</h3>
        <div style="margin-bottom: 16px;">
          <div style="margin-bottom: 8px;">
            <strong>缓存：</strong>${stats.cache.formatted}
          </div>
          <div style="margin-bottom: 8px;">
            <strong>内部存储：</strong>${stats.internal.formatted}
          </div>
          <div style="margin-bottom: 8px;">
            <strong>总计：</strong>${stats.total.formatted}
          </div>
        </div>
        <button class="glass-btn" id="clear-cache">清空缓存</button>
      </div>
    `;
  }
}
