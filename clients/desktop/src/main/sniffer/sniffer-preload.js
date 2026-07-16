/**
 * Sniffer Preload 脚本
 * 
 * 在隐藏窗口中注入 WebSocket 拦截器
 * 对齐 Android WebExtension 的 ws-sniffer
 * 
 * 原理：替换 window.WebSocket 构造函数，捕获所有 WS 事件
 * 通过 IPC 发送到主进程，由 SnifferSession 处理
 * 
 * 注意：contextIsolation 必须为 false 才能修改页面上下文
 */

// @ts-nocheck
const { ipcRenderer } = require('electron');

console.log('[WS-Intercept] Preload running...');

// 通知函数：发送事件到主进程
function notify(event) {
  try {
    ipcRenderer.send('sniffer-ws-event', JSON.stringify(event));
  } catch (e) {
    console.error('[WS-Intercept] IPC send failed:', e);
  }
}

// 注入 WebSocket 拦截器
const _origWebSocket = window.WebSocket;

window.WebSocket = function(url, protocols) {
  console.log('[WS-Intercept] Created:', url);

  notify({ t: 'open', u: url, ts: Date.now() });

  const ws = protocols ? new _origWebSocket(url, protocols) : new _origWebSocket(url);

  ws.addEventListener('message', function(event) {
    notify({
      t: 'receive', u: url, ts: Date.now(),
      d: typeof event.data === 'string' ? event.data : '[binary]',
      isBinary: typeof event.data !== 'string'
    });
  });

  ws.addEventListener('close', function() {
    notify({ t: 'close', u: url, ts: Date.now() });
  });

  ws.addEventListener('error', function() {
    notify({ t: 'error', u: url, ts: Date.now() });
  });

  const _origSend = ws.send.bind(ws);
  ws.send = function(data) {
    notify({
      t: 'send', u: url, ts: Date.now(),
      d: typeof data === 'string' ? data : '[binary]',
      isBinary: typeof data !== 'string'
    });
    return _origSend(data);
  };

  return ws;
};

window.WebSocket.prototype = _origWebSocket.prototype;
// @ts-ignore
window.WebSocket.CONNECTING = _origWebSocket.CONNECTING;
// @ts-ignore
window.WebSocket.OPEN = _origWebSocket.OPEN;
// @ts-ignore
window.WebSocket.CLOSING = _origWebSocket.CLOSING;
// @ts-ignore
window.WebSocket.CLOSED = _origWebSocket.CLOSED;

console.log('[WS-Intercept] WebSocket interceptor installed');
