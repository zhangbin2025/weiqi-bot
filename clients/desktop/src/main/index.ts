/**
 * Electron 主进程入口
 * 
 * 对等 Android MainActivity
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { AssetServer } from './server/asset-server';
import { BridgeRouter } from './ipc/bridge-router';
import { AppConfig } from './config';

// 单实例锁：防止多个实例同时运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 已有实例在运行，退出当前实例
  console.log('[Main] Another instance is already running, quitting...');
  app.quit();
  process.exit(0); // 立即退出，避免后续代码执行
}

// 当第二个实例启动时，聚焦第一个实例的窗口
app.on('second-instance', () => {
  console.log('[Main] Second instance detected, focusing main window');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let mainWindow: BrowserWindow | null = null;
let assetServer: AssetServer | null = null;
let bridgeRouter: BridgeRouter | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true, // 隐藏菜单栏
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: false, // 关闭隔离，让 prompt 覆盖生效（桥接需要）
      webSecurity: true,
    },
    title: 'WeiqiBot',
    show: false,
  });

  // 默认最大化
  mainWindow.maximize();

  // 拦截所有网络请求，转发到本地 AssetServer（对齐 Android GeckoView 行为）
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const url = details.url;
      
      // 跳过本地 AssetServer 请求（这些请求不需要代理）
      if (url.startsWith('http://127.0.0.1:8765') || url.startsWith('http://localhost:8765')) {
        callback({});
        return;
      }
      
      // 跳过 file:// 和 data: 协议
      if (url.startsWith('file://') || url.startsWith('data:')) {
        callback({});
        return;
      }
      
      // 跳过 devtools 相关请求
      if (url.includes('devtools') || url.startsWith('chrome-extension://')) {
        callback({});
        return;
      }
      
      // 外部 HTTP/HTTPS 请求 → 转发到本地 AssetServer 代理
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const proxyUrl = `http://127.0.0.1:8765/proxy/?url=${encodeURIComponent(url)}`;
        console.log(`[WebRequest] Redirect: ${url.substring(0, 80)}... -> proxy`);
        callback({ redirectURL: proxyUrl });
        return;
      }
      
      // 其他请求不处理
      callback({});
    }
  );

  // 设置 UserAgent，与 Android 对齐
  mainWindow.webContents.setUserAgent('WeiqiApp/1.0');

  // 拦截外部链接，用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 本地链接在当前窗口打开
    if (url.startsWith(`http://${AppConfig.localHost}:${AppConfig.localPort}`)) {
      mainWindow?.loadURL(url);
      return { action: 'deny' };
    }
    // 外部链接用系统浏览器打开
    const { shell } = require('electron');
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 键盘快捷键：导航
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Alt+Left 或 Backspace: 后退
    if ((input.alt && input.key === 'ArrowLeft') || (input.key === 'Backspace' && !input.alt && !input.control && !input.meta)) {
      if (mainWindow?.webContents.canGoBack()) {
        mainWindow.webContents.goBack();
      }
    }
    // Alt+Right 或 Shift+Backspace: 前进
    if ((input.alt && input.key === 'ArrowRight') || (input.key === 'Backspace' && input.shift)) {
      if (mainWindow?.webContents.canGoForward()) {
        mainWindow.webContents.goForward();
      }
    }
    // Alt+Home: 回到首页
    if (input.alt && input.key === 'Home') {
      const homeUrl = `http://${AppConfig.localHost}:${AppConfig.localPort}/index.html`;
      mainWindow?.loadURL(homeUrl);
    }
  });

  // 页面加载状态指示器（在窗口内容区域上方显示）
  let isLoading = false;
  let loadingTimeout: NodeJS.Timeout | null = null;

  // 显示加载指示器（延迟 500ms，避免快速加载时闪烁）
  const showLoadingIndicator = () => {
    if (loadingTimeout) clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => {
      if (isLoading) {
        pushTitle(50, '加载中...');
      }
    }, 500);
  };

  // 隐藏加载指示器
  const hideLoadingIndicator = () => {
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }
    popTitle(); // 移除加载中的消息
  };

  // 监听页面加载事件
  mainWindow.webContents.on('did-start-loading', () => {
    isLoading = true;
    showLoadingIndicator();
    console.log('[Main] Page started loading');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    isLoading = false;
    hideLoadingIndicator();
    console.log('[Main] Page finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    isLoading = false;
    hideLoadingIndicator();
    console.error('[Main] Page load failed:', errorCode, errorDesc);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const homeUrl = `http://${AppConfig.localHost}:${AppConfig.localPort}/index.html`;
  mainWindow.loadURL(homeUrl);

  // 页面加载失败时显示提示页面
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    console.error(`[Main] Page load failed: ${errorCode} ${errorDesc} ${validatedURL}`);
    if (errorCode === -3 || errorCode === -6) {
      // ERR_ABORTED 或 ERR_FILE_NOT_FOUND，可能是正在下载资源
      return;
    }
    const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>加载失败</title>
<style>body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:system-ui;background:#f5f5f5;color:#333;}
.c{text-align:center;padding:2rem;max-width:400px;}
h2{color:#e74c3c;margin-bottom:0.5rem;}
p{color:#666;font-size:14px;margin-bottom:1.5rem;line-height:1.6;}
button{padding:0.6rem 2rem;background:#667eea;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:15px;}
button:hover{background:#5a6fd6;}
</style></head>
<body><div class="c">
<h2>页面加载失败</h2>
<p>无法加载页面资源，请检查网络连接后重试。</p>
<button onclick="location.reload()">重新加载</button>
</div></body></html>`;
    mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startServer() {
  assetServer = new AssetServer();
  await assetServer.start();
  console.log(`[Main] AssetServer started on port ${AppConfig.localPort}`);
}

function setupIPC() {
  bridgeRouter = new BridgeRouter(mainWindow!);
  
  ipcMain.on('bridge', (event, message: string) => {
    try {
      const response = bridgeRouter!.handle(message);
      
      // 处理特殊返回值
      if (response === 'refresh') {
        // 刷新当前页面
        mainWindow?.webContents.reload();
        event.returnValue = JSON.stringify({ success: true });
        return;
      }
      
      // 同步返回（handle 必须同步返回结果）
      event.returnValue = response;
    } catch (err: any) {
      event.returnValue = JSON.stringify({ error: err.message });
    }
  });

  ipcMain.handle('bridge-async', async (_event, message: string) => {
    return await bridgeRouter!.handleAsync(message);
  });
}


// 标题管理器（优先级：启动 > 页面加载 > 按需下载）
let currentTitle = '围棋助手';
let titleStack: { priority: number; message: string }[] = [];

function updateTitle() {
  if (titleStack.length === 0) {
    mainWindow?.setTitle('围棋助手');
  } else {
    // 取最高优先级的消息
    const top = titleStack.sort((a, b) => b.priority - a.priority)[0];
    mainWindow?.setTitle(`围棋助手 - ${top.message}`);
  }
}

function pushTitle(priority: number, message: string) {
  titleStack.push({ priority, message });
  updateTitle();
}

function popTitle() {
  titleStack.pop();
  updateTitle();
}

// 格式化文件大小（对齐 Android UIHelper.formatSize）
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024.0;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024.0;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024.0;
  return `${gb.toFixed(1)} GB`;
}

// 下载提示状态
let downloadStartTime = 0;
let isDownloadHintShown = false;

// 显示下载提示（防抖，下载超过 1 秒才显示）
let downloadTitleId: string | null = null;

function showDownloadHint(message: string) {
  // 记录开始时间
  if (!isDownloadHintShown) {
    downloadStartTime = Date.now();
    isDownloadHintShown = true;
  }
  
  // 延迟显示（避免快速下载时闪烁）
  const elapsed = Date.now() - downloadStartTime;
  if (elapsed >= 1000 && !downloadTitleId) {
    downloadTitleId = 'download';
    pushTitle(30, message);
  } else if (downloadTitleId) {
    // 更新消息（保持优先级）
    titleStack = titleStack.filter(t => t.priority !== 30);
    pushTitle(30, message);
  }
}

// 隐藏下载提示
function hideDownloadHint() {
  if (downloadTitleId) {
    titleStack = titleStack.filter(t => t.priority !== 30);
    updateTitle();
    downloadTitleId = null;
  }
  isDownloadHintShown = false;
  downloadStartTime = 0;
}

app.whenReady().then(async () => {
  try {
    // Windows 通知显示的应用名，默认是 "electron app Weiqi"
    app.setAppUserModelId('com.weiqi.desktop');

    // 1. 创建 AssetServer
    const assetServer = new AssetServer();
    
    // 2. 创建窗口（提前创建，用于显示进度）
    createWindow();
    
    // 3. 检查版本并预下载核心资源（显示进度）
    console.log('[Main] Checking version and preloading core assets...');
    await assetServer.checkAndUpdateVersion((stage, progress) => {
      console.log(`[Main] ${stage}: ${progress}%`);
      pushTitle(100, `${stage} (${progress}%)`);
    });
    
    // 4. 启动服务器
    await assetServer.start();
    
    // 保存引用以便关闭
    (global as any).assetServer = assetServer;

    // 5. 设置 IPC 桥接
    setupIPC();

    // 6. 设置按需下载回调（对齐 Android）
    assetServer.onDemandCallback = {
      onDownloadStart: (filename: string, sizeBytes: number) => {
        const sizeHint = sizeBytes > 0 ? ` (${formatSize(sizeBytes)})` : '';
        showDownloadHint(`下载中: ${filename}${sizeHint}`);
      },
      onDownloadProgress: (filename: string, loaded: number, total: number) => {
        const progress = total > 0 ? Math.round((loaded / total) * 100) : -1;
        const loadedText = formatSize(loaded);
        const totalText = total > 0 ? formatSize(total) : '';
        
        const message = progress >= 0
          ? `下载 ${filename}: ${loadedText} / ${totalText} (${progress}%)`
          : `下载 ${filename}: ${loadedText}`;
        showDownloadHint(message);
      },
      onDownloadComplete: (filename: string) => {
        hideDownloadHint();
      }
    };

    console.log('[Main] App ready');
  } catch (error) {
    console.error('[Main] Failed to start app:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    const assetServer = (global as any).assetServer;
    if (assetServer) {
      assetServer.stop();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  const assetServer = (global as any).assetServer;
  if (assetServer) {
    assetServer.stop();
  }
  bridgeRouter?.cleanup();
});
