/**
 * Preload 脚本
 * 
 * 注入到渲染进程，拦截 window.prompt 实现桥接
 * contextIsolation: false，可直接操作 window
 */

import { ipcRenderer } from 'electron';

// 桥接前缀列表
const BRIDGE_PREFIXES = [
  'task:',
  'sniffer://',
  'katago:',
  'config:',
  'file:',
  'clipboard:',
  'debug:',
  'console:',
];

// 核心：覆盖 window.prompt，命中桥接前缀走 IPC
const originalPrompt = window.prompt;
window.prompt = (message?: string, _default?: string): string | null => {
  // 命中桥接前缀 → 走 IPC 同步调用
  if (message && BRIDGE_PREFIXES.some(prefix => message.startsWith(prefix))) {
    return ipcRenderer.sendSync('bridge', message);
  }
  // 非桥接 prompt → 返回默认值
  return _default || null;
};

// 暴露 electronAPI
(window as any).electronAPI = {
  // 同步桥接调用
  bridge: (message: string): string => {
    return ipcRenderer.sendSync('bridge', message);
  },

  // 异步桥接调用
  bridgeAsync: async (message: string): Promise<string> => {
    return await ipcRenderer.invoke('bridge-async', message);
  },

  // 平台标识
  platform: process.platform,

  // 是否是桌面端
  isDesktop: true,
  
  // App 环境标识（与 Android 对齐，用于 KataGoNativeClient 判断）
  isWeiqiApp: true,
  
  // prompt 替代函数
  prompt: (message: string): string | null => {
    if (BRIDGE_PREFIXES.some(prefix => message.startsWith(prefix))) {
      return ipcRenderer.sendSync('bridge', message);
    }
    return null;
  },
};

// 注入 TaskBridge（对等 Android injectTaskBridge）
(window as any).TaskBridge = {
  submitTask: (type: string, params: any, options?: any) => {
    const result = window.prompt(
      'task:submit:' + JSON.stringify({
        type,
        params: params || {},
        pageUrl: options?.pageUrl || '',
        schedule: options?.schedule || '',
      })
    );
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  getStatus: (taskId: string) => {
    const result = window.prompt('task:status:' + taskId);
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  cancelTask: (taskId: string) => {
    const result = window.prompt('task:cancel:' + taskId);
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  getCompletedTasks: () => {
    const result = window.prompt('task:listCompleted:');
    try {
      return JSON.parse(result || '');
    } catch {
      return [];
    }
  },

  deleteTask: (taskId: string) => {
    const result = window.prompt('task:delete:' + taskId);
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  // 调度相关方法
  addSchedule: (config: any) => {
    const result = window.prompt('task:schedule:add:' + JSON.stringify(config));
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  updateSchedule: (id: string, config: any) => {
    const result = window.prompt('task:schedule:update:' + JSON.stringify({ id, config }));
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  deleteSchedule: (id: string) => {
    const result = window.prompt('task:schedule:delete:' + id);
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  getSchedule: (id: string) => {
    const result = window.prompt('task:schedule:get:' + id);
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },

  listSchedules: () => {
    const result = window.prompt('task:schedule:list');
    try {
      return JSON.parse(result || '[]');
    } catch {
      return [];
    }
  },

  runSchedule: (id: string) => {
    const result = window.prompt('task:schedule:run:' + id);
    try {
      return JSON.parse(result || '');
    } catch {
      return { error: result };
    }
  },
};

// 注入桌面端导航：顶部悬浮导航栏，鼠标移到顶部时滑出
function injectNavOverlay() {
  if (!document.body) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectNavOverlay);
    } else {
      setTimeout(injectNavOverlay, 100);
    }
    return;
  }
  
  // 已经注入过
  if (document.getElementById('desktop-nav-bar')) {
    return;
  }
  
  const style = document.createElement('style');
  style.textContent = `
    .desktop-nav-trigger {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: 8px !important;
      z-index: 2147483646 !important;
    }
    #desktop-nav-bar {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: 40px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      padding: 0 12px !important;
      background: rgba(250, 248, 245, 0.92) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      box-shadow: 0 1px 6px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04) !important;
      transform: translateY(-100%) !important;
      transition: transform 0.2s ease !important;
      user-select: none !important;
    }
    .desktop-nav-trigger:hover + #desktop-nav-bar,
    #desktop-nav-bar:hover {
      transform: translateY(0) !important;
    }
    #desktop-nav-bar .dn-btn {
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      max-width: 32px !important;
      max-height: 32px !important;
      border-radius: 6px !important;
      border: none !important;
      background: rgba(0, 0, 0, 0.05) !important;
      color: rgba(60, 60, 60, 0.8) !important;
      font-size: 14px !important;
      line-height: 1 !important;
      padding: 0 !important;
      margin: 0 !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: background 0.15s ease !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    #desktop-nav-bar .dn-btn:hover {
      background: rgba(0, 0, 0, 0.09) !important;
      color: rgba(30, 30, 30, 0.95) !important;
    }
    #desktop-nav-bar .dn-btn:active {
      background: rgba(0, 0, 0, 0.14) !important;
    }
    #desktop-nav-bar .dn-btn:disabled {
      opacity: 0.3 !important;
      cursor: default !important;
    }
    #desktop-nav-bar .dn-title {
      flex: 1 !important;
      text-align: center !important;
      color: rgba(60, 60, 60, 0.6) !important;
      font-size: 13px !important;
      font-weight: 400 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      padding: 0 12px !important;
      line-height: 40px !important;
    }
    #desktop-nav-bar .dn-sep {
      width: 1px !important;
      height: 18px !important;
      background: rgba(0, 0, 0, 0.08) !important;
      margin: 0 6px !important;
      flex-shrink: 0 !important;
    }
    .desktop-nav-trigger:hover + #desktop-nav-bar::after,
    #desktop-nav-bar:hover::after {
      content: '' !important;
      position: absolute !important;
      bottom: -2px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: 36px !important;
      height: 3px !important;
      border-radius: 2px !important;
      background: rgba(0, 0, 0, 0.12) !important;
    }
  `;
  document.head.appendChild(style);

  // 触发区域：鼠标移到顶部 8px 区域时显示导航栏
  const trigger = document.createElement('div');
  trigger.className = 'desktop-nav-trigger';
  document.body.appendChild(trigger);

  // 导航栏
  const navBar = document.createElement('div');
  navBar.id = 'desktop-nav-bar';

  // 后退按钮
  const backBtn = document.createElement('button');
  backBtn.className = 'dn-btn';
  backBtn.title = '后退 (Alt+Left)';
  backBtn.innerHTML = '&#9664;'; // ◀

  // 前进按钮
  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'dn-btn';
  forwardBtn.title = '前进 (Alt+Right)';
  forwardBtn.innerHTML = '&#9654;'; // ▶

  // 分隔线
  const sep1 = document.createElement('div');
  sep1.className = 'dn-sep';

  // 页面标题
  const titleEl = document.createElement('div');
  titleEl.className = 'dn-title';
  titleEl.textContent = document.title || 'WeiqiBot';

  // 分隔线
  const sep2 = document.createElement('div');
  sep2.className = 'dn-sep';

  // 刷新按钮
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'dn-btn';
  refreshBtn.title = '刷新 (Ctrl+R)';
  refreshBtn.innerHTML = '&#8635;'; // ↻

  navBar.appendChild(backBtn);
  navBar.appendChild(forwardBtn);
  navBar.appendChild(sep1);
  navBar.appendChild(titleEl);
  navBar.appendChild(sep2);
  navBar.appendChild(refreshBtn);
  document.body.appendChild(navBar);

  // 更新导航按钮状态
  const updateNavState = () => {
    try {
      const result = (window as any).electronAPI?.bridge('nav:state');
      if (result) {
        const state = JSON.parse(result);
        backBtn.disabled = !state.canGoBack;
        forwardBtn.disabled = !state.canGoForward;
      }
    } catch {}
    titleEl.textContent = document.title || 'WeiqiBot';
  };

  // 点击事件
  backBtn.addEventListener('click', () => {
    (window as any).electronAPI?.bridge('nav:back');
    setTimeout(updateNavState, 300);
  });
  forwardBtn.addEventListener('click', () => {
    (window as any).electronAPI?.bridge('nav:forward');
    setTimeout(updateNavState, 300);
  });
  refreshBtn.addEventListener('click', () => {
    window.location.reload();
  });

  // 页面导航后更新状态
  const observer = new MutationObserver(() => {
    titleEl.textContent = document.title || 'WeiqiBot';
  });
  observer.observe(document.querySelector('title') || document.head, { childList: true, characterData: true, subtree: true });

  // 初始更新
  setTimeout(updateNavState, 500);

  console.log('[Preload] Desktop nav bar injected');
}

// 立即尝试注入
injectNavOverlay();

// 确保 navigator.userAgent 包含 WeiqiApp（用于 KataGoNativeClient 判断）
// Electron 的 webContents.setUserAgent 可能不生效，需要在 JS 层强制设置
const ensureWeiqiAppUserAgent = () => {
  if (typeof navigator !== 'undefined' && !navigator.userAgent.includes('WeiqiApp')) {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'WeiqiApp/1.0',
      configurable: true
    });
    console.log('[Preload] Override navigator.userAgent to WeiqiApp/1.0');
  }
};

// 立即尝试执行（如果 DOM 已就绪）
if (document.head) {
  ensureWeiqiAppUserAgent();
} else {
  // DOM 未就绪，等待 DOMContentLoaded
  document.addEventListener('DOMContentLoaded', ensureWeiqiAppUserAgent);
}

// 页面导航时重新注入
ipcRenderer.on('did-navigate', () => {
  injectNavOverlay();
});

// 监听主进程推送的 KataGo 结果（替代 executeJavaScript，更可靠）
// executeJavaScript 在页面导航或加载时会丢失，而 IPC 事件会排队等待
ipcRenderer.on('katago:result', (_event, json: string) => {
  if (typeof (window as any).onKatagoResult === 'function') {
    try {
      (window as any).onKatagoResult(json);
    } catch (e) {
      console.error('[Preload] onKatagoResult error:', e);
    }
  }
});

// 监听主进程的页面导航事件（通知点击等场景）
// 用前端路由代替 loadURL，避免整页刷新
ipcRenderer.on('navigate', (_event, route: string) => {
  console.log('[Preload] navigate:', route);
  // 使用 history.pushState + popstate 事件触发前端路由
  // 或者直接修改 window.location（SPA 兼容方式）
  if (route && route.startsWith('/')) {
    // 构建完整 URL 并导航
    const fullUrl = `http://127.0.0.1:8765${route}`;
    window.location.href = fullUrl;
  }
});

// 注入 Console Hook（对齐 Android ConsoleHook.kt）
function injectConsoleHook() {
  if ((window as any).__consoleHooked) return;
  (window as any).__consoleHooked = true;
  
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  function sendLog(level: string, args: IArguments) {
    const msg = Array.prototype.slice.call(args)
      .map(x => typeof x === 'object' ? JSON.stringify(x) : String(x))
      .join(' ');
    
    // 获取调用栈
    let caller = '';
    try {
      const stack = new Error().stack || '';
      const lines = stack.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('console.') === -1 && lines[i].trim()) {
          caller = lines[i].trim();
          break;
        }
      }
    } catch (e) {}
    
    // 发送到主进程
    window.prompt('console:' + JSON.stringify({ level, msg, caller }));
  }

  console.log = function() {
    sendLog('LOG', arguments);
    originalConsole.log.apply(console, Array.prototype.slice.call(arguments));
  };

  console.info = function() {
    sendLog('INFO', arguments);
    originalConsole.info.apply(console, Array.prototype.slice.call(arguments));
  };

  console.warn = function() {
    sendLog('WARN', arguments);
    originalConsole.warn.apply(console, Array.prototype.slice.call(arguments));
  };

  console.error = function() {
    sendLog('ERROR', arguments);
    originalConsole.error.apply(console, Array.prototype.slice.call(arguments));
  };

  console.debug = function() {
    sendLog('DEBUG', arguments);
    originalConsole.debug.apply(console, Array.prototype.slice.call(arguments));
  };
  
  console.log('[Preload] Console hook injected');
}

// 立即注入 console hook
injectConsoleHook();

console.log('[Preload] Bridge injected');
