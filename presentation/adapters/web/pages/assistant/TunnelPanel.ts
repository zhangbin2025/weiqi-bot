/**
 * @fileoverview 隧道配置面板
 * @description 远程连接配置 UI：模式切换、密码输入、连通性检测、连接状态
 *
 * UI 结构：
 * - 弹出对话框（overlay + dialog）
 * - 三个模式选项：关闭 / 作为服务端 / 作为客户端
 * - 密码输入框（默认密文，眼睛按钮切换明文）
 * - 连接状态指示灯
 * - 测试按钮（仅客户端可用）
 * - 保存并应用按钮
 */

import { TunnelServer } from '../../../../../infrastructure/tunnel/TunnelServer';
import { TunnelClient } from '../../../../../infrastructure/tunnel/TunnelClient';
import { KatagoRpcHandler } from '../../../../../infrastructure/tunnel/KatagoRpcHandler';
import type { ITunnelConfig, TunnelMode, TunnelConnectionState } from '../../../../../infrastructure/tunnel/types';
import { DEFAULT_TUNNEL_CONFIG } from '../../../../../infrastructure/tunnel/types';
import type { IAIEngine } from '../../../../../infrastructure/ai/IAIEngine';

/** localStorage 键名 */
const STORAGE_KEY = 'weiqi-tunnel-config';

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

export class TunnelPanel {
  private overlay: HTMLElement;
  private dialog: HTMLElement;
  private server: TunnelServer | null = null;
  private client: TunnelClient | null = null;
  private engine: IAIEngine | null = null;
  private currentMode: TunnelMode = 'none';
  private currentState: TunnelConnectionState = 'disconnected';
  private onModeChange: ((mode: TunnelMode, client: TunnelClient | null, server: TunnelServer | null) => void) | null = null;
  /** 编辑中的配置（show 时加载，render 时复用，不重新从 localStorage 读） */
  private editConfig: ITunnelConfig = { ...DEFAULT_TUNNEL_CONFIG };
  /** 密码是否明文显示 */
  private passwordVisible = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'tunnel-panel-overlay';
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5); display: none;
      justify-content: center; align-items: center; z-index: 10000;
    `;
    this.dialog = document.createElement('div');
    this.dialog.className = 'tunnel-panel-dialog';
    this.dialog.style.cssText = `
      background: white; padding: 20px; border-radius: 12px;
      width: 90%; max-width: 360px; max-height: 85vh; overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    `;
    this.overlay.appendChild(this.dialog);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  /** 设置模式变更回调（通知 createAIEngine 切换适配器） */
  setOnModeChange(callback: (mode: TunnelMode, client: TunnelClient | null, server: TunnelServer | null) => void): void {
    this.onModeChange = callback;
  }

  /** 设置引擎实例（服务端模式用于注册到 handler） */
  setEngine(engine: IAIEngine): void {
    this.engine = engine;
    if (this.server) {
      const handler = new KatagoRpcHandler(engine);
      this.server.registerHandler(handler);
    }
  }

  /** 显示面板 */
  show(): void {
    // 打开时从 localStorage 加载编辑配置，重置密码可见性
    this.editConfig = this.loadConfig();
    this.passwordVisible = false;
    this.render();
    this.overlay.style.display = 'flex';
    document.body.appendChild(this.overlay);
  }

  /** 隐藏面板 */
  hide(): void {
    this.overlay.style.display = 'none';
    if (this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
  }

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

  /** 渲染面板内容 */
  private render(): void {
    const config = this.editConfig;
    this.currentMode = config.mode;
    this.currentState = this.server?.getState() || this.client?.getState() || 'disconnected';

    const stateColor = STATE_COLORS[this.currentState];
    const stateLabel = STATE_LABELS[this.currentState];

    // 同步当前密码输入框的值（render 前先从 DOM 读回来）
    const passwordInputEl = this.dialog.querySelector('#tunnelPassword') as HTMLInputElement | null;
    if (passwordInputEl) {
      this.editConfig.password = passwordInputEl.value;
    }

    const pwdType = this.passwordVisible ? 'text' : 'password';
    const eyeIcon = this.passwordVisible ? '🙈' : '👁️';

    this.dialog.innerHTML = `
      <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #333;">🔗 远程连接</h3>

      <!-- 模式选择 -->
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 14px; color: #666; margin-bottom: 8px;">模式</label>
        <div style="display: flex; gap: 8px;">
          <button class="tunnel-mode-btn" data-mode="none" style="
            flex: 1; padding: 10px; border: 2px solid ${config.mode === 'none' ? '#667eea' : '#e0e0e0'};
            border-radius: 8px; background: ${config.mode === 'none' ? '#667eea' : '#fff'};
            color: ${config.mode === 'none' ? '#fff' : '#333'}; font-size: 14px; cursor: pointer; transition: all 0.2s;
          ">关闭</button>
          <button class="tunnel-mode-btn" data-mode="server" style="
            flex: 1; padding: 10px; border: 2px solid ${config.mode === 'server' ? '#667eea' : '#e0e0e0'};
            border-radius: 8px; background: ${config.mode === 'server' ? '#667eea' : '#fff'};
            color: ${config.mode === 'server' ? '#fff' : '#333'}; font-size: 14px; cursor: pointer; transition: all 0.2s;
          ">服务端</button>
          <button class="tunnel-mode-btn" data-mode="client" style="
            flex: 1; padding: 10px; border: 2px solid ${config.mode === 'client' ? '#667eea' : '#e0e0e0'};
            border-radius: 8px; background: ${config.mode === 'client' ? '#667eea' : '#fff'};
            color: ${config.mode === 'client' ? '#fff' : '#333'}; font-size: 14px; cursor: pointer; transition: all 0.2s;
          ">客户端</button>
        </div>
        <div id="tunnelModeDesc" style="font-size: 12px; color: #999; margin-top: 6px;">
          ${this.getModeDescription(config.mode)}
        </div>
      </div>

      <!-- 密码输入 -->
      <div style="margin-bottom: 16px;" id="tunnelPasswordSection">
        <label style="display: block; font-size: 14px; color: #666; margin-bottom: 8px;">密码（固定房间号）</label>
        <div style="display: flex; gap: 0; align-items: stretch;">
          <input type="${pwdType}" id="tunnelPassword" value="${this.escapeHtml(config.password)}" placeholder="设置密码" style="
            flex: 1; padding: 10px 12px; border: 2px solid #e0e0e0; border-right: none; border-radius: 8px 0 0 8px;
            font-size: 16px; box-sizing: border-box; outline: none;" />
          <button id="tunnelEyeBtn" style="
            border: 2px solid #e0e0e0; border-left: none; border-radius: 0 8px 8px 0;
            background: #f5f5f5; padding: 0 12px; cursor: pointer; font-size: 18px;
            display: flex; align-items: center; justify-content: center;
          ">${eyeIcon}</button>
        </div>
        <div style="font-size: 12px; color: #999; margin-top: 4px;">
          ${config.mode === 'server' ? '客户端需使用相同密码连接' : config.mode === 'client' ? '需与服务端密码一致' : '密码同时作为连接房间号'}
        </div>
      </div>

      <!-- 连接状态 -->
      <div style="margin-bottom: 16px;" id="tunnelStatusSection">
        <label style="display: block; font-size: 14px; color: #666; margin-bottom: 8px;">连接状态</label>
        <div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f5f5f5; border-radius: 8px;">
          <div style="width: 12px; height: 12px; border-radius: 50%; background: ${stateColor}; flex-shrink: 0;"></div>
          <span style="font-size: 14px; color: #333;" id="tunnelStateLabel">${stateLabel}</span>
        </div>
      </div>

      <!-- 按钮 -->
      <div style="display: flex; gap: 8px;">
        <button id="tunnelTestBtn" style="
          flex: 1; padding: 10px; border: none; border-radius: 8px;
          background: ${config.mode === 'client' ? '#e8e4f0' : '#f0f0f0'};
          color: ${config.mode === 'client' ? '#667eea' : '#bbb'};
          font-size: 14px; cursor: ${config.mode === 'client' ? 'pointer' : 'not-allowed'};
        " ${config.mode !== 'client' ? 'disabled' : ''}>测试连接</button>
        <button id="tunnelSaveBtn" style="
          flex: 1; padding: 10px; border: none; border-radius: 8px;
          background: #07C160; color: #fff; font-size: 14px; cursor: pointer;
        ">保存并应用</button>
      </div>
    `;

    this.bindEvents();
  }

  /** HTML 转义 */
  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 获取模式描述 */
  private getModeDescription(mode: TunnelMode): string {
    switch (mode) {
      case 'none': return '不使用远程连接，所有请求走本地';
      case 'server': return '本机作为服务端，提供计算能力，等待远程客户端接入';
      case 'client': return '本机作为客户端，请求转发到远程服务端执行';
    }
  }

  /** 绑定事件 */
  private bindEvents(): void {
    // 模式按钮 — 只修改 editConfig，不重新读 localStorage
    const modeBtns = this.dialog.querySelectorAll('.tunnel-mode-btn');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        // 先把密码输入框的当前值同步到 editConfig
        const pwdInput = this.dialog.querySelector('#tunnelPassword') as HTMLInputElement;
        if (pwdInput) this.editConfig.password = pwdInput.value;
        const mode = (btn as HTMLElement).dataset['mode'] as TunnelMode;
        this.editConfig.mode = mode;
        this.render();
      });
    });

    // 密码眼睛按钮
    const eyeBtn = this.dialog.querySelector('#tunnelEyeBtn') as HTMLButtonElement;
    eyeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      // 同步当前密码值
      const pwdInput = this.dialog.querySelector('#tunnelPassword') as HTMLInputElement;
      if (pwdInput) this.editConfig.password = pwdInput.value;
      this.passwordVisible = !this.passwordVisible;
      this.render();
      // render 后聚焦回输入框
      setTimeout(() => {
        const newInput = this.dialog.querySelector('#tunnelPassword') as HTMLInputElement;
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      }, 0);
    });

    // 测试按钮
    const testBtn = this.dialog.querySelector('#tunnelTestBtn') as HTMLButtonElement;
    testBtn?.addEventListener('click', async () => {
      // 从 DOM 读取最新密码
      const passwordInput = this.dialog.querySelector('#tunnelPassword') as HTMLInputElement;
      const password = passwordInput.value.trim();
      if (!password) {
        this.updateStatus('error', '请输入密码');
        return;
      }
      testBtn.disabled = true;
      testBtn.textContent = '测试中...';
      try {
        const testConfig: ITunnelConfig = { ...this.editConfig, password, mode: 'client' };
        const testClient = new TunnelClient(testConfig);
        testClient.onStateChange((state, info) => {
          this.updateStatus(state, info);
        });
        await testClient.connect();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (testClient.isConnected) {
          this.updateStatus('connected', '测试成功');
        }
        testClient.disconnect();
      } catch (err) {
        this.updateStatus('error', err instanceof Error ? err.message : '测试失败');
      }
      testBtn.disabled = false;
      testBtn.textContent = '测试连接';
    });

    // 保存按钮
    const saveBtn = this.dialog.querySelector('#tunnelSaveBtn') as HTMLButtonElement;
    saveBtn?.addEventListener('click', () => {
      const passwordInput = this.dialog.querySelector('#tunnelPassword') as HTMLInputElement;
      const password = passwordInput.value.trim();
      const mode = this.editConfig.mode;

      if (mode !== 'none' && !password) {
        alert('请输入密码');
        return;
      }

      const newConfig: ITunnelConfig = { ...this.editConfig, password };
      this.saveConfig(newConfig);
      this.applyConfig(newConfig);
      this.hide();
    });
  }

  /** 更新状态显示 */
  private updateStatus(state: TunnelConnectionState, info?: string): void {
    this.currentState = state;
    const indicator = this.dialog.querySelector('#tunnelStateLabel');
    if (indicator) {
      const label = STATE_LABELS[state];
      indicator.textContent = info ? `${label} (${info})` : label;
      const dot = indicator.parentElement?.querySelector('div');
      if (dot) {
        (dot as HTMLElement).style.background = STATE_COLORS[state];
      }
    }
  }

  /** 应用配置（保存到 localStorage，服务端模式启动） */
  private applyConfig(config: ITunnelConfig): void {
    this.stopTunnel();
    this.editConfig = { ...config };

    if (config.mode === 'none') {
      this.onModeChange?.('none', null, null);
      return;
    }

    if (config.mode === 'server') {
      this.startServer(config);
    }
    // 客户端模式：只保存配置，不自动连接
    // 各页面通过 TunnelManager.getClient() 按需连接
  }

  /** 启动服务端 */
  private startServer(config: ITunnelConfig): void {
    if (!this.engine) {
      console.warn('[TunnelPanel] No engine set for server mode');
      return;
    }
    this.server = new TunnelServer(config);
    this.server.onStateChange((state, info) => {
      this.currentState = state;
      console.log('[TunnelPanel] Server state:', state, info);
    });
    const handler = new KatagoRpcHandler(this.engine);
    this.server.registerHandler(handler);
    this.server.start().catch((err) => {
      console.error('[TunnelPanel] Failed to start server:', err);
    });
    this.onModeChange?.('server', null, this.server);
  }

  /** 启动客户端 */
  private startClient(config: ITunnelConfig): void {
    this.client = new TunnelClient(config);
    this.client.onStateChange((state, info) => {
      this.currentState = state;
      console.log('[TunnelPanel] Client state:', state, info);
    });
    this.client.connect().catch((err) => {
      console.error('[TunnelPanel] Failed to connect client:', err);
    });
    this.onModeChange?.('client', this.client, null);
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
  }

  /** 初始化：读取配置，服务端模式自动启动（页面加载时调用） */
  init(): void {
    const config = this.loadConfig();
    this.editConfig = { ...config };
    // 只有服务端模式在 assistant 页面自动启动
    // 客户端模式不自动连接，由各页面通过 TunnelManager 按需连接
    if (config.mode === 'server' && config.password) {
      this.startServer(config);
      this.onModeChange?.('server', null, this.server);
    }
  }

  /** 获取当前模式 */
  getCurrentMode(): TunnelMode {
    return this.currentMode;
  }

  /** 获取当前客户端（供 createAIEngine 使用） */
  getClient(): TunnelClient | null {
    return this.client;
  }
}
