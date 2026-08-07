/**
 * Electron 主进程入口
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { AssetServer } from './server/asset-server';
import { BridgeRouter } from './ipc/bridge-router';
import { AppConfig } from './config';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Main] Another instance is already running, quitting...');
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, commandLine) => {
  console.log('[Main] Second instance detected, focusing main window');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    handleSgfFileFromArgs(commandLine);
  }
});

let pendingSgfFile: string | null = null;

function isSgfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.sgf');
}

function extractSgfFileFromArgs(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) continue;
    if (isSgfFile(arg)) {
      return arg;
    }
  }
  return null;
}

function handleSgfFileFromArgs(args: string[]) {
  const sgfFile = extractSgfFileFromArgs(args);
  if (sgfFile) {
    console.log('[Main] Found SGF file in args:', sgfFile);
    pendingSgfFile = sgfFile;
    loadSgfFile();
  }
}

async function loadSgfFile() {
  if (!pendingSgfFile || !mainWindow) return;

  try {
    const fs = require('fs');
    const path = require('path');
    const sgfContent = fs.readFileSync(pendingSgfFile, 'utf-8');
    const fileName = path.basename(pendingSgfFile);
    console.log('[Main] Loaded SGF file:', fileName, 'size:', sgfContent.length);

    const assistantUrl = `http://${AppConfig.localHost}:${AppConfig.localPort}/assistant/index.html`;
    mainWindow.loadURL(assistantUrl);

    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[Main] Assistant page loaded, sending SGF file...');
      sendSgfToAssistant(sgfContent, fileName);
    });

    pendingSgfFile = null;
  } catch (error) {
    console.error('[Main] Failed to load SGF file:', error);
    pendingSgfFile = null;
  }
}

function sendSgfToAssistant(sgfContent: string, fileName: string) {
  if (!mainWindow) return;

  const message = 'Opened SGF file: ' + fileName + '\n\nSGF content:\n```sgf\n' + sgfContent + '\n```';
  console.log('[Desktop] Sending SGF message, length:', message.length);

  const messageJson = JSON.stringify(message);
  let attempts = 0;
  const maxAttempts = 20;
  const retryInterval = 500;

  const trySend = () => {
    if (!mainWindow) return;
    attempts++;
    mainWindow.webContents.executeJavaScript(
      'window.assistantSendMessage ? (window.assistantSendMessage(' + messageJson + '), "sent") : "not_ready"'
    ).then((result: string) => {
      if (result === 'sent') {
        console.log('[Desktop] SGF message sent successfully (attempt', attempts + ')');
      } else if (attempts < maxAttempts) {
        setTimeout(trySend, retryInterval);
      } else {
        console.error('[Desktop] Failed to send SGF: assistantSendMessage not available after', maxAttempts, 'attempts');
      }
    }).catch((err: Error) => {
      if (attempts < maxAttempts) {
        setTimeout(trySend, retryInterval);
      } else {
        console.error('[Desktop] Failed to send SGF:', err);
      }
    });
  };

  trySend();
}

let mainWindow: BrowserWindow | null = null;
let assetServer: AssetServer | null = null;
let bridgeRouter: BridgeRouter | null = null;

/**
 * 创建加载窗口（显示下载进度）
 */
function createLoadingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 500,
    height: 320,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: '围棋助手',
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#667eea',
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}

/**
 * 更新加载窗口的进度
 */
function updateLoadingProgress(loadingWindow: BrowserWindow, stage: string, progress: number) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 28px; margin-bottom: 24px; font-weight: 300; }
    .progress-container { width: 360px; margin-bottom: 16px; }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #fff;
      border-radius: 3px;
      width: ${progress}%;
    }
    .stage-text { margin-top: 16px; font-size: 15px; font-weight: 500; }
    .progress-text { margin-top: 8px; font-size: 14px; opacity: 0.85; }
  </style>
</head>
<body>
  <div class="container">
    <h1>围棋助手</h1>
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill"></div>
      </div>
    </div>
    <div class="stage-text">${stage}</div>
    <div class="progress-text">${progress}%</div>
  </div>
</body>
</html>`;

  loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: false,
      webSecurity: true,
    },
    title: 'WeiqiBot',
    show: false,
  });

  mainWindow.maximize();

  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const url = details.url;
      
      if (url.startsWith('http://127.0.0.1:8765') || url.startsWith('http://localhost:8765')) {
        callback({});
        return;
      }
      
      if (url.startsWith('file://') || url.startsWith('data:')) {
        callback({});
        return;
      }
      
      if (url.includes('devtools') || url.startsWith('chrome-extension://')) {
        callback({});
        return;
      }
      
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const proxyUrl = `http://127.0.0.1:8765/proxy/?url=${encodeURIComponent(url)}`;
        callback({ redirectURL: proxyUrl });
        return;
      }
      
      callback({});
    }
  );

  mainWindow.webContents.setUserAgent('WeiqiApp/1.0');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${AppConfig.localHost}:${AppConfig.localPort}`)) {
      mainWindow?.loadURL(url);
      return { action: 'deny' };
    }
    const { shell } = require('electron');
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.alt && input.key === 'ArrowLeft') || (input.key === 'Backspace' && !input.alt && !input.control && !input.meta)) {
      if (mainWindow?.webContents.canGoBack()) {
        mainWindow.webContents.goBack();
      }
    }
    if ((input.alt && input.key === 'ArrowRight') || (input.key === 'Backspace' && input.shift)) {
      if (mainWindow?.webContents.canGoForward()) {
        mainWindow.webContents.goForward();
      }
    }
    if (input.alt && input.key === 'Home') {
      const homeUrl = `http://${AppConfig.localHost}:${AppConfig.localPort}/index.html`;
      mainWindow?.loadURL(homeUrl);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const homeUrl = `http://${AppConfig.localHost}:${AppConfig.localPort}/index.html`;
  mainWindow.loadURL(homeUrl);

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
      
      if (response === 'refresh') {
        mainWindow?.webContents.reload();
        event.returnValue = JSON.stringify({ success: true });
        return;
      }
      
      event.returnValue = response;
    } catch (err: any) {
      event.returnValue = JSON.stringify({ error: err.message });
    }
  });

  ipcMain.handle('bridge-async', async (_event, message: string) => {
    return await bridgeRouter!.handleAsync(message);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024.0;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024.0;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024.0;
  return `${gb.toFixed(1)} GB`;
}

let downloadStartTime = 0;
let isDownloadHintShown = false;

function showDownloadHint(message: string) {
  if (!isDownloadHintShown) {
    downloadStartTime = Date.now();
    isDownloadHintShown = true;
  }
  
  const elapsed = Date.now() - downloadStartTime;
  if (elapsed >= 1000) {
    mainWindow?.setTitle(`围棋助手 - ${message}`);
  }
}

function hideDownloadHint() {
  mainWindow?.setTitle('围棋助手');
  isDownloadHintShown = false;
  downloadStartTime = 0;
}

let loadingWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  try {
    app.setAppUserModelId('com.weiqi.desktop');

    // 阶段1：创建并启动 AssetServer
    const assetServer = new AssetServer();
    await assetServer.start();
    
    // 阶段2：创建加载窗口
    loadingWindow = createLoadingWindow();
    updateLoadingProgress(loadingWindow, '正在初始化...', 0);
    
    // 阶段3：预下载资源（实时更新加载窗口）
    await assetServer.checkAndUpdateVersion((stage, progress) => {
      console.log(`[Main] Preload: ${stage} ${progress}%`);
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        updateLoadingProgress(loadingWindow, stage, progress);
      }
    });
    
    // 阶段4：关闭加载窗口，创建主窗口
    loadingWindow?.close();
    loadingWindow = null;
    
    createMainWindow();

    (global as any).assetServer = assetServer;
    setupIPC();

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
    handleSgfFileFromArgs(process.argv);

    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      console.log('[Main] open-file event:', filePath);
      pendingSgfFile = filePath;
      loadSgfFile();
    });

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
    createMainWindow();
  }
});

app.on('before-quit', () => {
  const assetServer = (global as any).assetServer;
  if (assetServer) {
    assetServer.stop();
  }
  bridgeRouter?.cleanup();
});
