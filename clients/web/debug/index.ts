/**
 * 日志页面入口
 * @description 支持本地日志和远程服务端日志查看
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { DebugService } from '../../../services/debug/DebugService';
import { Dialog } from '../shared/ui';
import { WebFileExporter } from '../../../infrastructure/utils/export/WebFileExporter';
import { TunnelManager } from '../../../infrastructure/tunnel/TunnelManager';

/** 日志筛选条件 */
interface LogFilter {
  levels?: string[];  // 选中的日志级别
  keyword?: string;   // 关键字
}

/** 勾选状态持久化 */
const REMOTE_CHECK_KEY = 'debug-remote-mode';

async function main() {
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  const debugService = new DebugService();

  // 渲染日志页面
  await renderLogs(debugService);

  console.info('日志页面已启动');
}

/** 是否为客户端模式（可使用远程日志） */
function isClientMode(): boolean {
  return TunnelManager.getInstance().isClientMode();
}

/** 读取远程勾选状态 */
function isRemoteMode(): boolean {
  return sessionStorage.getItem(REMOTE_CHECK_KEY) === 'true';
}

/** 保存远程勾选状态 */
function setRemoteMode(enabled: boolean): void {
  sessionStorage.setItem(REMOTE_CHECK_KEY, enabled ? 'true' : 'false');
}

/**
 * 通过隧道 RPC 获取远程服务端日志
 */
async function getRemoteLogs(limit?: number): Promise<any[]> {
  const client = await TunnelManager.getInstance().waitForConnection();
  if (!client) {
    throw new Error('远程服务端未连接');
  }
  const result = await client.call('debug', 'getLogs', { limit });
  return result as any[];
}

/**
 * 通过隧道 RPC 获取远程日志统计
 */
async function getRemoteLogStats(): Promise<any> {
  const client = await TunnelManager.getInstance().waitForConnection();
  if (!client) {
    throw new Error('远程服务端未连接');
  }
  const result = await client.call('debug', 'getLogStats', undefined);
  return result as any;
}

/**
 * 通过隧道 RPC 清空远程日志
 */
async function clearRemoteLogs(): Promise<void> {
  const client = await TunnelManager.getInstance().waitForConnection();
  if (!client) {
    throw new Error('远程服务端未连接');
  }
  await client.call('debug', 'clearLogs', undefined);
}

/**
 * 获取日志（根据本地/远程模式自动切换）
 */
async function fetchLogs(debugService: DebugService, limit: number): Promise<any[]> {
  if (isRemoteMode()) {
    return getRemoteLogs(limit);
  }
  return debugService.getLogs({ limit });
}

/**
 * 获取日志统计（根据本地/远程模式自动切换）
 */
async function fetchLogStats(debugService: DebugService): Promise<any> {
  if (isRemoteMode()) {
    return getRemoteLogStats();
  }
  return debugService.getLogStats();
}

/**
 * 清空日志（根据本地/远程模式自动切换）
 */
async function clearLogs(debugService: DebugService): Promise<void> {
  if (isRemoteMode()) {
    return clearRemoteLogs();
  }
  return debugService.clearLogs();
}

async function renderLogs(debugService: DebugService, filter?: LogFilter) {
  const container = document.getElementById('page-root');
  if (!container) return;

  const remoteMode = isRemoteMode();
  const clientMode = isClientMode();

  // 尝试获取日志和统计
  let logs: any[] = [];
  let stats: any = { total: 0, error: 0, warn: 0, info: 0, debug: 0 };
  let loadError = '';

  try {
    logs = await fetchLogs(debugService, 200);
    stats = await fetchLogStats(debugService);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  // 应用筛选
  const filteredLogs = filterLogs(logs, filter);

  // 构建标题
  let titleText: string;
  if (loadError) {
    titleText = '⚠️ 加载失败';
  } else {
    titleText = `共 ${stats.total} 条${filter ? `（显示 ${filteredLogs.length} 条）` : ''}`;
  }

  // 渲染
  container.innerHTML = [
    '<div class="log-panel">',
      '<div class="log-header">',
        '<div class="log-header-left">',
          clientMode ? [
            '<label class="remote-toggle" title="勾选后查看远程服务端的调试日志">',
              `<input type="checkbox" id="remote-toggle" ${remoteMode ? 'checked' : ''}>`,
              '<span class="remote-toggle-label">远程</span>',
            '</label>',
          ].join('') : '',
          `<span class="log-count">${titleText}</span>`,
        '</div>',
        '<div class="log-header-controls">',
          '<button class="icon-btn" id="export-btn" title="导出">📤</button>',
          '<button class="icon-btn" id="filter-btn" title="筛选">🔍</button>',
          '<button class="icon-btn" id="refresh-btn" title="刷新">🔄</button>',
          '<button class="icon-btn" id="clear-btn" title="清空">🗑️</button>',
        '</div>',
      '</div>',
      loadError ? [
        '<div class="log-error-banner">',
          `${remoteMode ? '远程服务端' : '本地'}日志获取失败：${escapeHtml(loadError)}`,
          remoteMode ? '<div class="log-error-hint">请确认远程页面已配置并连接</div>' : '',
        '</div>',
      ].join('') : '',
      '<div class="log-list" id="log-list">',
        renderLogList(filteredLogs),
      '</div>',
    '</div>',
  ].join('');

  // 自动滚动到底部，显示最新日志
  const logList = document.getElementById('log-list');
  if (logList) {
    logList.scrollTop = logList.scrollHeight;
  }

  // 绑定远程切换勾选框
  document.getElementById('remote-toggle')?.addEventListener('change', async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    setRemoteMode(checked);
    await renderLogs(debugService);
  });

  // 绑定导出按钮
  document.getElementById('export-btn')?.addEventListener('click', async () => {
    await exportLogs(debugService, logs);
  });

  // 绑定筛选按钮
  document.getElementById('filter-btn')?.addEventListener('click', async () => {
    await showFilterDialog(debugService, filter);
  });

  // 绑定刷新按钮
  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    await renderLogs(debugService, filter);
  });

  // 绑定清空按钮
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    const target = isRemoteMode() ? '远程服务端' : '本地';
    const confirmed = await Dialog.confirm(`确定要清空${target}所有日志吗？`);
    if (confirmed) {
      try {
        await clearLogs(debugService);
        await renderLogs(debugService, filter);
      } catch (e) {
        await Dialog.alert(`清空失败：${e instanceof Error ? e.message : '未知错误'}`);
      }
    }
  });
}

/**
 * 筛选日志
 */
function filterLogs(logs: any[], filter?: LogFilter): any[] {
  if (!filter) return logs;
  
  let result = logs;
  
  // 按级别筛选
  if (filter.levels && filter.levels.length > 0) {
    result = result.filter(log => filter.levels!.includes(log.level));
  }
  
  // 按关键字筛选
  if (filter.keyword && filter.keyword.trim()) {
    const keyword = filter.keyword.trim().toLowerCase();
    result = result.filter(log => {
      return log.tag.toLowerCase().includes(keyword) ||
             log.message.toLowerCase().includes(keyword);
    });
  }
  
  return result;
}

/**
 * 显示筛选弹框
 */
async function showFilterDialog(debugService: DebugService, currentFilter?: LogFilter): Promise<void> {
  // 创建弹框
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  
  const dialog = document.createElement('div');
  dialog.className = 'dialog filter-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  
  const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
  const selectedLevels = currentFilter?.levels || [];
  
  dialog.innerHTML = [
    '<div class="dialog-title">筛选日志</div>',
    '<div class="dialog-content">',
      '<div class="filter-section">',
        '<label class="filter-label">日志级别：</label>',
        '<div class="filter-levels">',
          ...levels.map(level => [
            '<label class="filter-checkbox">',
              `<input type="checkbox" value="${level}" ${selectedLevels.includes(level) ? 'checked' : ''}>`,
              `<span class="filter-checkbox-label">${level}</span>`,
            '</label>',
          ].join('')),
        '</div>',
      '</div>',
      '<div class="filter-section">',
        '<label class="filter-label">关键字：</label>',
        `<input type="text" class="filter-input" id="filter-keyword" placeholder="输入标签或消息关键字" value="${currentFilter?.keyword || ''}">`,
      '</div>',
    '</div>',
    '<div class="dialog-btn-group">',
      '<button class="dialog-btn secondary" id="filter-reset">重置</button>',
      '<button class="dialog-btn secondary" id="filter-cancel">取消</button>',
      '<button class="dialog-btn primary" id="filter-ok">确定</button>',
    '</div>',
  ].join('');
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  // 强制 reflow 后再加 .show，确保动画播放
  void overlay.offsetWidth;
  overlay.classList.add('show');
  
  // 获取控件
  const keywordInput = dialog.querySelector('#filter-keyword') as HTMLInputElement;
  const checkboxes = dialog.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
  const okBtn = dialog.querySelector('#filter-ok') as HTMLButtonElement;
  const cancelBtn = dialog.querySelector('#filter-cancel') as HTMLButtonElement;
  const resetBtn = dialog.querySelector('#filter-reset') as HTMLButtonElement;
  
  // 关闭弹框
  const close = () => {
    overlay.classList.remove('show');
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  };
  
  // 获取当前筛选条件
  const getFilter = (): LogFilter => {
    const levels: string[] = [];
    checkboxes.forEach(cb => {
      if (cb.checked) levels.push(cb.value);
    });
    const keyword = keywordInput.value.trim();
    return { levels: levels.length > 0 ? levels : undefined, keyword: keyword || undefined };
  };
  
  // 确定
  okBtn.addEventListener('click', async () => {
    close();
    await renderLogs(debugService, getFilter());
  });
  
  // 取消
  cancelBtn.addEventListener('click', () => {
    close();
  });
  
  // 重置
  resetBtn.addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = false);
    keywordInput.value = '';
  });
  
  // 点击背景关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  
  // ESC 关闭
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  
  // 聚焦到关键字输入框
  keywordInput.focus();
}

function renderLogList(logs: any[]): string {
  if (logs.length === 0) {
    return '<div class="log-empty">暂无日志</div>';
  }

  return logs.map(log => [
    `<div class="log-entry ${log.level.toLowerCase()}">`,
      `<span class="log-time">${formatTime(log.timestamp)}</span>`,
      `<span class="log-level ${log.level.toLowerCase()}">[${log.level}]</span>`,
      `<span class="log-tag">[${log.tag}]</span>`,
      `<span class="log-message">${escapeHtml(log.message)}</span>`,
    '</div>',
  ].join('')).join('');
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 导出日志到 JSON 文件
 */
async function exportLogs(debugService: DebugService, logs: any[]): Promise<void> {
  try {
    // 获取所有日志（不限制数量）
    const allLogs = await fetchLogs(debugService, 10000);
    
    if (allLogs.length === 0) {
      await Dialog.alert('暂无日志可导出');
      return;
    }
    
    const sourceLabel = isRemoteMode() ? '远程服务端' : '本地';
    
    // 创建导出数据
    const exportData = {
      exportTime: new Date().toISOString(),
      source: sourceLabel,
      totalLogs: allLogs.length,
      logs: allLogs.map(log => ({
        timestamp: log.timestamp,
        time: new Date(log.timestamp).toISOString(),
        level: log.level,
        tag: log.tag,
        message: log.message,
      })),
    };
    
    // 使用 WebFileExporter 导出
    const exporter = new WebFileExporter();
    const filename = `debug_logs_${formatDate()}.json`;
    const result = await exporter.exportJSON(exportData, filename);
    
    if (result.success) {
      await Dialog.alert(`📤 ${sourceLabel}日志已导出\n\n文件：${filename}\n日志数量：${allLogs.length} 条\n\n请在浏览器下载列表或文件管理器中查看`);
    } else {
      await Dialog.alert(`导出失败：${result.error || '未知错误'}`);
    }
  } catch (error) {
    console.error('[exportLogs] 导出失败:', error);
    await Dialog.alert(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 格式化日期
 */
function formatDate(): string {
  return new Date().toISOString().split('T')[0]!;
}

main().catch(console.error);
