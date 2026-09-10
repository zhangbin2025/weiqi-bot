/**
 * @fileoverview 远程隧道服务页面控制器
 * @description 独立页面：配置隧道、监控连接状态、RPC 调用统计、实时日志
 *
 * 功能：
 * - 扩展菜单：模式选择、密码输入、配置保存、连接测试（仅客户端）
 * - 定时刷新监控区（5 秒）
 * - 数据缓存到 LocalStorageCacheAdapter，页面刷新不丢失
 */

import { TunnelServer } from '../../../../../infrastructure/tunnel/TunnelServer';
import { KatagoRpcHandler } from '../../../../../infrastructure/tunnel/KatagoRpcHandler';
import { createAIEngine } from '../../../../../infrastructure/ai';
import { TunnelClient } from '../../../../../infrastructure/tunnel/TunnelClient';
import type {
  ITunnelConfig,
  TunnelMode,
  TunnelConnectionState,
  TunnelServerStats,
  TunnelClientStats,
} from '../../../../../infrastructure/tunnel/types';
import { DEFAULT_TUNNEL_CONFIG } from '../../../../../infrastructure/tunnel/types';
import { LocalStorageCacheAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageCacheAdapter';
import type { ICacheStorageAdapter } from '../../../../../infrastructure/storage/interfaces/ICacheStorage';

/** localStorage 配置键名（与 TunnelManager 保持一致） */
const STORAGE_KEY = 'weiqi-tunnel-config';

/** 缓存 namespace */
const CACHE_NAMESPACE = 'weiqi-tunnel';

/** 缓存键 */
const CACHE_KEY_STATS = 'tunnel-stats';

/** 定时刷新间隔（毫秒） */
const REFRESH_INTERVAL = 5_000;

/** 状态颜色映射 */
const STATE_COLORS: Record<TunnelConnectionState, string> = {
  disconnected: '#999',
  connecting: '#ffa726',
  'signaling-ok': '#42a5f5',
  authenticating: '#ffa726',
  connected: '#66bb6a',
  'auth-failed': '#ef5350',
  error: '#ef5350',
};

/** 状态中文映射 */
const STATE_LABELS: Record<TunnelConnectionState, string> = {
  disconnected: '未连接',
  connecting: '连接中...',
  'signaling-ok': '信令已连接，等待P2P',
  authenticating: '验证密码中...',
  connected: '已连接',
  'auth-failed': '密码错误',
  error: '错误',
};

/** 日志级别颜色 */
const LOG_COLORS: Record<string, string> = {
  info: '#08f',
  warn: '#f80',
  error: '#f44',
};

export class RemotePage {
  private rootContainer: HTMLElement;
  private server: TunnelServer | null = null;
  private aiEngine: ReturnType<typeof createAIEngine> | null = null;
  private client: TunnelClient | null = null;
  private cache: ICacheStorageAdapter;
  private currentMode: TunnelMode = 'none';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private passwordVisible = false;
  private editConfig: ITunnelConfig = { ...DEFAULT_TUNNEL_CONFIG };

  constructor(rootContainer: HTMLElement) {
    this.rootContainer = rootContainer;
    this.cache = new LocalStorageCacheAdapter(CACHE_NAMESPACE);
  }

  /** 初始化页面 */
  async init(): Promise<void> {
    // 初始化缓存
    try {
      await this.cache.initialize();
    } catch (e) {
      console.warn('[RemotePage] Cache init failed:', e);
    }

    // 先挂载全局函数（HTML onclick 依赖）
    this.bindGlobalEvents();

    // 加载配置
    this.editConfig = this.loadConfig();
    this.currentMode = this.editConfig.mode;

    // 渲染页面骨架
    this.renderSkeleton();

    // 从缓存恢复数据
    await this.restoreFromCache();

    // 根据模式自动启动
    if (this.editConfig.mode === 'server' && this.editConfig.password) {
      this.startServer(this.editConfig);
    } else if (this.editConfig.mode === 'client' && this.editConfig.password) {
      // 客户端模式：通过 TunnelManager 懒连接，这里只启动一个 TunnelClient 用于监控
      this.startClientMonitor(this.editConfig);
    }

    // 开始定时刷新
    this.startRefresh();

    console.info('[RemotePage] 页面已启动，模式:', this.editConfig.mode);
  }

  // ─── 配置管理 ───

  /** 读取配置 */
  private loadConfig(): ITunnelConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_TUNNEL_CONFIG, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_TUNNEL_CONFIG };
  }

  /** 保存配置 */
  private saveConfig(config: ITunnelConfig): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  // ─── 缓存管理 ───

  /** 写入缓存 */
  private async writeCache(data: TunnelServerStats | TunnelClientStats): Promise<void> {
    try {
      await this.cache.set(CACHE_KEY_STATS, data);
    } catch (e) {
      console.warn('[RemotePage] Cache write failed:', e);
    }
  }

  /** 从缓存恢复 */
  private async restoreFromCache(): Promise<void> {
    try {
      const cached = await this.cache.get<TunnelServerStats | TunnelClientStats>(CACHE_KEY_STATS);
      if (cached) {
        this.renderMonitorArea(cached);
      }
    } catch (e) {
      console.warn('[RemotePage] Cache restore failed:', e);
    }
  }

  // ─--- 隧道控制 ─---

  /** 启动服务端 */
  private startServer(config: ITunnelConfig): void {
    this.stopTunnel();
    this.server = new TunnelServer(config);
    this.server.onStateChange((state, info) => {
      this.renderStatusBar(state, info);
    });
    // 创建 AI 引擎并注册为 katago 服务
    this.aiEngine = createAIEngine();
    const handler = new KatagoRpcHandler(this.aiEngine);
    this.server.registerHandler(handler);
    this.server.start().catch((err) => {
      console.error('[RemotePage] Failed to start server:', err);
    });
    this.currentMode = 'server';
  }

  /** 启动客户端监控 */
  private startClientMonitor(config: ITunnelConfig): void {
    this.stopTunnel();
    this.client = new TunnelClient(config);
    this.client.onStateChange((state, info) => {
      this.renderStatusBar(state, info);
    });
    this.client.connect().catch((err) => {
      console.error('[RemotePage] Failed to connect client:', err);
    });
    this.currentMode = 'client';
  }

  /** 停止隧道 */
  private stopTunnel(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.aiEngine = null;
  }

  /** 测试连接（客户端模式） */
  private async testConnection(password: string): Promise<{ success: boolean; message: string }> {
    const testConfig: ITunnelConfig = {
      ...this.editConfig,
      password,
      mode: 'client',
    };
    try {
      const testClient = new TunnelClient(testConfig);
      const result = await new Promise<{ success: boolean; message: string }>((resolve) => {
        const timeout = setTimeout(() => {
          testClient.disconnect();
          resolve({ success: false, message: '连接超时' });
        }, 10_000);

        testClient.onStateChange((state) => {
          if (state === 'connected') {
            clearTimeout(timeout);
            resolve({ success: true, message: '连接成功' });
          } else if (state === 'auth-failed') {
            clearTimeout(timeout);
            resolve({ success: false, message: '密码错误' });
          } else if (state === 'error') {
            clearTimeout(timeout);
            resolve({ success: false, message: '连接错误' });
          }
        });

        testClient.connect().catch((err) => {
          clearTimeout(timeout);
          resolve({ success: false, message: err instanceof Error ? err.message : '连接失败' });
        });
      });
      testClient.disconnect();
      return result;
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : '测试失败' };
    }
  }

  /** 应用配置（保存 + 重启） */
  private applyConfig(config: ITunnelConfig): void {
    this.saveConfig(config);
    this.editConfig = { ...config };
    this.stopTunnel();

    if (config.mode === 'server' && config.password) {
      this.startServer(config);
    } else if (config.mode === 'client' && config.password) {
      this.startClientMonitor(config);
    }
    this.currentMode = config.mode;
    this.renderStatusBar(this.server?.getState() || this.client?.getState() || 'disconnected');
  }

  // ─── 渲染 ───

  /** 初始化页面骨架 */
  private renderSkeleton(): void {
    this.rootContainer.innerHTML =
      '<div class="tab-panel active" id="panel-status" data-tab="status"></div>' +
      '<div class="tab-panel" id="panel-clients" data-tab="clients"></div>' +
      '<div class="tab-panel" id="panel-rpc" data-tab="rpc"></div>' +
      '<div class="tab-panel" id="panel-logs" data-tab="logs"></div>';
  }

  /** 渲染状态面板 */
  private renderStatusBar(state: TunnelConnectionState, info?: string): void {
    const panel = document.getElementById('panel-status');
    if (!panel) return;
    const color = STATE_COLORS[state] || '#999';
    const connected = state === 'connected';
    const parts = [];
    parts.push('模式: ' + this.getModeLabel(this.editConfig.mode));
    if (this.editConfig.password) parts.push('密码: ' + this.maskPassword(this.editConfig.password));
    if (info) parts.push(info);
    panel.innerHTML =
      '<div class="status-card">' +
        '<div class="status-dot' + (connected ? ' connected' : '') + '" style="background:' + color + '"></div>' +
        '<div class="status-info">' +
          '<div class="status-label">' + (STATE_LABELS[state] || state) + '</div>' +
          '<div class="status-detail">' + parts.join('  ') + '</div>' +
        '</div>' +
      '</div>';
  }

  /** 渲染监控区 */
  /** 渲染监控区（写入各标签面板） */
  private renderMonitorArea(stats: TunnelServerStats | TunnelClientStats): void {
    // 状态面板
    this.renderStatusBar(stats.state);

    // 接入记录
    const clientPanel = document.getElementById('panel-clients');
    if (clientPanel) {
      const clients = 'clientHistory' in stats ? stats.clientHistory : [];
      const badgeClients = document.getElementById('badgeClients');
      if (badgeClients) badgeClients.textContent = String(clients.length);
      if (clients.length > 0) {
        clientPanel.innerHTML = clients.map((c) => {
          const connectTime = this.formatTime(c.connectedAt);
          const duration = c.disconnectedAt
            ? this.formatDuration(c.disconnectedAt - c.connectedAt)
            : '在线';
          const statusIcon = c.disconnectedAt ? '⚪' : '🟢';
          return '<div class="list-item">' +
            '<span class="item-icon">' + statusIcon + '</span>' +
            '<span class="item-main">' + (c.remoteAddress || '客户端 #' + c.id.split('-')[1]) + '</span>' +
            '<span class="item-meta">' + connectTime + ' · ' + duration + ' · RPC ' + c.rpcCount + '次</span>' +
            '</div>';
        }).join('');
      } else {
        clientPanel.innerHTML = '<div class="empty-hint">暂无记录</div>';
      }
    }

    // RPC 统计
    const rpcPanel = document.getElementById('panel-rpc');
    if (rpcPanel) {
      const badgeRpc = document.getElementById('badgeRpc');
      if (badgeRpc) badgeRpc.textContent = String(stats.rpcStats.length);
      if (stats.rpcStats.length > 0) {
        rpcPanel.innerHTML = stats.rpcStats.map((r) => {
          const lastCall = this.formatTime(r.lastCallAt);
          return '<div class="list-item">' +
            '<span class="item-main">' + r.service + '.' + r.method + '</span>' +
            '<span class="item-meta">' + r.count + '次 · 平均' + r.avgDurationMs + 'ms · ' + lastCall + '</span>' +
            '</div>';
        }).join('');
      } else {
        rpcPanel.innerHTML = '<div class="empty-hint">暂无调用</div>';
      }
    }

    // 日志
    const logPanel = document.getElementById('panel-logs');
    if (logPanel) {
      const badgeLogs = document.getElementById('badgeLogs');
      if (badgeLogs) badgeLogs.textContent = String(stats.recentLogs.length);
      if (stats.recentLogs.length > 0) {
        logPanel.innerHTML = stats.recentLogs.map((log) => {
          const time = this.formatTime(log.timestamp);
          const color = LOG_COLORS[log.level] || '#333';
          const levelLabel = log.level === 'info' ? 'INFO' : log.level === 'warn' ? 'WARN' : log.level === 'error' ? 'ERROR' : log.level;
          return '<div class="log-entry" style="border-left-color:' + color + '">' +
            '<div class="log-entry-header">' +
              '<span class="log-level ' + log.level + '">' + levelLabel + '</span>' +
              '<span class="log-time">' + time + '</span>' +
            '</div>' +
            '<div class="log-msg">' + this.escapeHtml(log.message) + '</div>' +
          '</div>';
        }).join('');
        logPanel.scrollTop = logPanel.scrollHeight;
      } else {
        logPanel.innerHTML = '<div class="empty-hint">暂无日志</div>';
      }
    }
  }
  // ─── 定时刷新 ───

  private startRefresh(): void {
    this.stopRefresh();
    this.refreshTimer = setInterval(() => {
      this.doRefresh();
    }, REFRESH_INTERVAL);
    // 首次立即刷新
    this.doRefresh();
  }

  private stopRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async doRefresh(): Promise<void> {
    let stats: TunnelServerStats | TunnelClientStats | null = null;

    if (this.server) {
      stats = this.server.getStats();
    } else if (this.client) {
      stats = this.client.getClientStats();
    }

    if (stats) {
      this.renderMonitorArea(stats);
      await this.writeCache(stats);
    }
  }

  // ─--- 配置弹窗 ─---

  /** 显示配置弹窗 */
  private showConfigDialog(): void {
    this.toggleCommandMenu();
    this.editConfig = this.loadConfig();
    this.passwordVisible = false;
    this.renderConfigDialog();
  }

  /** 渲染配置弹窗 */
  private renderConfigDialog(): void {
    // 移除已有弹窗
    const existing = document.getElementById('configOverlay');
    if (existing) existing.remove();

    const config = this.editConfig;
    const pwdType = this.passwordVisible ? 'text' : 'password';
    const eyeIcon = this.passwordVisible ? '🙈' : '👁️';
    const isClient = config.mode === 'client';
    const testBtnDisabled = isClient ? '' : 'disabled';
    const testBtnColor = isClient ? '#667eea' : '#bbb';
    const testBtnBg = isClient ? '#e8e4f0' : '#f0f0f0';

    const overlay = document.createElement('div');
    overlay.id = 'configOverlay';
    overlay.className = 'tunnel-panel-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:10000;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;padding:20px;border-radius:12px;width:90%;max-width:360px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);';

    dialog.innerHTML = [
      '<h3 style="margin:0 0 16px 0;font-size:18px;color:#333;">🔧 隧道配置</h3>',
      // 模式选择
      '<div style="margin-bottom:16px;">',
      '  <label style="display:block;font-size:14px;color:#666;margin-bottom:8px;">模式</label>',
      '  <div style="display:flex;gap:8px;">',
      this.renderModeBtn('none', '关闭', config.mode),
      this.renderModeBtn('server', '服务端', config.mode),
      this.renderModeBtn('client', '客户端', config.mode),
      '  </div>',
      '  <div style="font-size:12px;color:#999;margin-top:6px;">' + this.getModeDescription(config.mode) + '</div>',
      '</div>',
      // 密码输入
      '<div style="margin-bottom:16px;">',
      '  <label style="display:block;font-size:14px;color:#666;margin-bottom:8px;">密码（固定房间号）</label>',
      '  <div style="display:flex;gap:0;align-items:stretch;">',
      '    <input type="' + pwdType + '" id="cfgPassword" value="' + this.escapeHtml(config.password) + '" placeholder="设置密码" style="flex:1;padding:10px 12px;border:2px solid #e0e0e0;border-right:none;border-radius:8px 0 0 8px;font-size:16px;box-sizing:border-box;outline:none;" />',
      '    <button id="cfgEyeBtn" style="border:2px solid #e0e0e0;border-left:none;border-radius:0 8px 8px 0;background:#f5f5f5;padding:0 12px;cursor:pointer;font-size:18px;">' + eyeIcon + '</button>',
      '  </div>',
      '  <div style="font-size:12px;color:#999;margin-top:4px;">' + (config.mode === 'server' ? '客户端需使用相同密码连接' : config.mode === 'client' ? '需与服务端密码一致' : '密码同时作为连接房间号') + '</div>',
      '</div>',
      // 按钮
      '<div style="display:flex;gap:8px;">',
      '  <button id="cfgTestBtn" style="flex:1;padding:10px;border:none;border-radius:8px;background:' + testBtnBg + ';color:' + testBtnColor + ';font-size:14px;cursor:' + (isClient ? 'pointer' : 'not-allowed') + ';" ' + testBtnDisabled + '>测试连接</button>',
      '  <button id="cfgSaveBtn" style="flex:1;padding:10px;border:none;border-radius:8px;background:#07C160;color:#fff;font-size:14px;cursor:pointer;">保存并应用</button>',
      '</div>',
    ].join('');

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // 绑定事件
    this.bindConfigEvents(dialog, overlay);
  }

  /** 渲染模式按钮 */
  private renderModeBtn(mode: TunnelMode, label: string, currentMode: TunnelMode): string {
    const selected = mode === currentMode;
    const border = selected ? '#667eea' : '#e0e0e0';
    const bg = selected ? '#667eea' : '#fff';
    const color = selected ? '#fff' : '#333';
    return '<button class="cfg-mode-btn" data-mode="' + mode + '" style="flex:1;padding:10px;border:2px solid ' + border + ';border-radius:8px;background:' + bg + ';color:' + color + ';font-size:14px;cursor:pointer;transition:all 0.2s;">' + label + '</button>';
  }

  /** 绑定配置弹窗事件 */
  private bindConfigEvents(dialog: HTMLElement, overlay: HTMLElement): void {
    // 模式按钮
    const modeBtns = dialog.querySelectorAll('.cfg-mode-btn');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const pwdInput = dialog.querySelector('#cfgPassword') as HTMLInputElement;
        if (pwdInput) this.editConfig.password = pwdInput.value;
        const mode = (btn as HTMLElement).dataset['mode'] as TunnelMode;
        this.editConfig.mode = mode;
        // 重新渲染弹窗
        overlay.remove();
        this.renderConfigDialog();
        // 恢复密码输入焦点
        setTimeout(() => {
          const newInput = document.querySelector('#cfgPassword') as HTMLInputElement;
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(newInput.value.length, newInput.value.length);
          }
        }, 0);
      });
    });

    // 密码眼睛
    const eyeBtn = dialog.querySelector('#cfgEyeBtn');
    eyeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const pwdInput = dialog.querySelector('#cfgPassword') as HTMLInputElement;
      if (pwdInput) this.editConfig.password = pwdInput.value;
      this.passwordVisible = !this.passwordVisible;
      overlay.remove();
      this.renderConfigDialog();
    });

    // 测试按钮
    const testBtn = dialog.querySelector('#cfgTestBtn') as HTMLButtonElement;
    testBtn?.addEventListener('click', async () => {
      const pwdInput = dialog.querySelector('#cfgPassword') as HTMLInputElement;
      const password = pwdInput.value.trim();
      if (!password) {
        alert('请输入密码');
        return;
      }
      testBtn.disabled = true;
      testBtn.textContent = '测试中...';
      const result = await this.testConnection(password);
      testBtn.disabled = false;
      testBtn.textContent = '测试连接';
      alert(result.message);
    });

    // 保存按钮
    const saveBtn = dialog.querySelector('#cfgSaveBtn') as HTMLButtonElement;
    saveBtn?.addEventListener('click', () => {
      const pwdInput = dialog.querySelector('#cfgPassword') as HTMLInputElement;
      const password = pwdInput.value.trim();
      const mode = this.editConfig.mode;

      if (mode !== 'none' && !password) {
        alert('请输入密码');
        return;
      }

      const newConfig: ITunnelConfig = { ...this.editConfig, password };
      this.applyConfig(newConfig);
      overlay.remove();
    });
  }

  // ─── 工具方法 ───

  private getModeLabel(mode: TunnelMode): string {
    switch (mode) {
      case 'none': return '关闭';
      case 'server': return '服务端';
      case 'client': return '客户端';
    }
  }

  private getModeDescription(mode: TunnelMode): string {
    switch (mode) {
      case 'none': return '不使用远程连接，所有请求走本地';
      case 'server': return '本机作为服务端，提供计算能力，等待远程客户端接入';
      case 'client': return '本机作为客户端，请求转发到远程服务端执行';
    }
  }

  /** 脱敏密码：只显示前1后1 */
  private maskPassword(pwd: string): string {
    if (!pwd) return '';
    if (pwd.length <= 2) return '*'.repeat(pwd.length);
    return pwd[0] + '*'.repeat(Math.min(pwd.length - 2, 6)) + pwd[pwd.length - 1];
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  private formatDuration(ms: number): string {
    if (ms < 60_000) return Math.round(ms / 1000) + '秒';
    return Math.round(ms / 60_000) + '分钟';
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** 切换扩展菜单 */
  private toggleCommandMenu(): void {
    const menu = document.getElementById('commandMenu');
    const overlay = document.getElementById('commandMenuOverlay');
    if (menu && overlay) {
      const isVisible = menu.style.display === 'block';
      menu.style.display = isVisible ? 'none' : 'block';
      overlay.style.display = isVisible ? 'none' : 'block';
    }
  }

  /** 切换标签页 */
  private switchTab(tab: string): void {
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-tab') === tab);
    });
  }

  /** 绑定全局事件 */
  private bindGlobalEvents(): void {
    (window as any).toggleCommandMenu = () => this.toggleCommandMenu();
    (window as any).showConfigDialog = () => this.showConfigDialog();
    (window as any).manualRefresh = () => this.doRefresh();
    (window as any).switchTab = (tab: string) => this.switchTab(tab);
  }

  /** 销毁 */
  destroy(): void {
    this.stopRefresh();
    this.stopTunnel();
  }
}
