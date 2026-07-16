/**
 * 调试页面渲染器
 * @module presentation/adapters/web/pages/debug/DebugRenderer
 */
import type { LogEntry, LogStats, StorageStats, MemoryInfo, AppInfo } from '@services/debug/types';
import { LogRenderer } from './renderers/LogRenderer';
import { StorageRenderer } from './renderers/StorageRenderer';
import { PerfRenderer } from './renderers/PerfRenderer';
/**
 * 调试页面渲染器
 */
export class DebugRenderer {
  private logRenderer = new LogRenderer();
  private storageRenderer = new StorageRenderer();
  private perfRenderer = new PerfRenderer();
  /**
   * 渲染页面框架
   */
  renderShell() {
    const container = document.getElementById('page-root');
    if (!container) return;
    container.innerHTML = `
      <div class="debug-tabs glass-card" style="padding: 12px; margin-bottom: 16px;">
        <button class="debug-tab glass-btn active" data-tab="logs">📋 日志</button>
        <button class="debug-tab glass-btn" data-tab="storage">💾 存储</button>
        <button class="debug-tab glass-btn" data-tab="performance">⚡ 性能</button>
      </div>
      <div id="debug-content"></div>
    `;
  }
  /**
   * 渲染 App 信息
   */
  renderAppInfo(info: AppInfo) {
    const header = document.querySelector('.glass-subtitle');
    if (header) {
      header.textContent = `${info.version} | ${info.model} | ${info.os}`;
    }
  }
  /**
   * 渲染日志
   */
  renderLogs(logs: LogEntry[], stats: LogStats) {
    const container = document.getElementById('debug-content');
    if (!container) return;
    container.innerHTML = this.logRenderer.render(logs, stats);
  }
  /**
   * 渲染存储
   */
  renderStorage(stats: StorageStats) {
    const container = document.getElementById('debug-content');
    if (!container) return;
    container.innerHTML = this.storageRenderer.render(stats);
  }
  /**
   * 渲染性能
   */
  renderPerformance(memory: MemoryInfo) {
    const container = document.getElementById('debug-content');
    if (!container) return;
    container.innerHTML = this.perfRenderer.render(memory);
  }
}
