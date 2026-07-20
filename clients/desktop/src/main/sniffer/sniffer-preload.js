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

/**
 * 将二进制数据转换为 Base64
 * 支持 ArrayBuffer、Blob、Uint8Array 等格式
 */
function binaryToBase64(data) {
  try {
    let bytes;

    // ArrayBuffer
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    }
    // Blob
    else if (data instanceof Blob) {
      console.warn('[WS-Intercept] Blob data detected, need async conversion');
      return '[blob]';
    }
    // Uint8Array 或其他 TypedArray
    else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    // 其他情况
    else {
      console.warn('[WS-Intercept] Unknown binary format:', typeof data);
      return '[unknown-binary]';
    }

    // 转换为 Base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    console.error('[WS-Intercept] Binary to Base64 conversion failed:', e);
    return '[conversion-failed]';
  }
}

// 注入 WebSocket 拦截器
const _origWebSocket = window.WebSocket;

window.WebSocket = function(url, protocols) {
  console.log('[WS-Intercept] Created:', url);

  notify({ t: 'open', u: url, ts: Date.now() });

  const ws = protocols ? new _origWebSocket(url, protocols) : new _origWebSocket(url);

  ws.addEventListener('message', function(event) {
    const isBinary = typeof event.data !== 'string';
    let dataStr;

    if (isBinary) {
      // 二进制数据：转换为 Base64
      dataStr = binaryToBase64(event.data);
      const size = event.data.byteLength || event.data.size || 'unknown';
      console.log('[WS-Intercept] Received binary, size:', size, ', base64 length:', dataStr.length);
    } else {
      // 文本数据：直接使用
      dataStr = event.data;
    }

    notify({
      t: 'receive',
      u: url,
      ts: Date.now(),
      d: dataStr,
      isBinary: isBinary
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
    const isBinary = typeof data !== 'string';
    let dataStr;

    if (isBinary) {
      // 二进制数据：转换为 Base64
      dataStr = binaryToBase64(data);
      console.log('[WS-Intercept] Sent binary, base64 length:', dataStr.length);
    } else {
      // 文本数据：直接使用
      dataStr = data;
    }

    notify({
      t: 'send',
      u: url,
      ts: Date.now(),
      d: dataStr,
      isBinary: isBinary
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
