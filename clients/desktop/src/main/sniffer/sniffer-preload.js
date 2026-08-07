/**
 * Sniffer Preload 脚本
 *
 * 在隐藏窗口中注入 WebSocket 和 HTTP 拦截器
 * 对齐 Android WebExtension 的 ws-sniffer 实现
 *
 * 功能：
 * 1. WebSocket 拦截（原有功能）
 * 2. HTTP 拦截（新增：fetch 和 XMLHttpRequest）
 *
 * 注意：contextIsolation 必须为 false 才能修改页面上下文
 */

// @ts-nocheck
const { ipcRenderer } = require('electron');

// 通知函数：发送事件到主进程
function notify(event) {
  try {
    ipcRenderer.send('sniffer-ws-event', JSON.stringify(event));
  } catch (e) {
    console.error('[Sniffer] IPC send failed:', e);
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
      console.warn('[Sniffer] Blob data detected, need async conversion');
      return '[blob]';
    }
    // Uint8Array 或其他 TypedArray
    else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    // 其他情况
    else {
      console.warn('[Sniffer] Unknown binary format:', typeof data);
      return '[unknown-binary]';
    }

    // 转换为 Base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    console.error('[Sniffer] Binary to Base64 conversion failed:', e);
    return '[conversion-failed]';
  }
}

// ========== WebSocket Hook（原有功能）==========
const _origWebSocket = window.WebSocket;

window.WebSocket = function(url, protocols) {
  notify({ t: 'ws_open', u: url, ts: Date.now() });

  const ws = protocols ? new _origWebSocket(url, protocols) : new _origWebSocket(url);

  ws.addEventListener('message', function(event) {
    const isBinary = typeof event.data !== 'string';
    let dataStr;

    if (isBinary) {
      // 二进制数据：转换为 Base64
      dataStr = binaryToBase64(event.data);
    } else {
      // 文本数据：直接使用
      dataStr = event.data;
    }

    notify({
      t: 'ws_receive',
      u: url,
      ts: Date.now(),
      d: dataStr,
      isBinary: isBinary
    });
  });

  ws.addEventListener('close', function() {
    notify({ t: 'ws_close', u: url, ts: Date.now() });
  });

  ws.addEventListener('error', function() {
    notify({ t: 'ws_error', u: url, ts: Date.now() });
  });

  const _origSend = ws.send.bind(ws);
  ws.send = function(data) {
    const isBinary = typeof data !== 'string';
    let dataStr;

    if (isBinary) {
      // 二进制数据：转换为 Base64
      dataStr = binaryToBase64(data);
    } else {
      // 文本数据：直接使用
      dataStr = data;
    }

    notify({
      t: 'ws_send',
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

// ========== HTTP Hook（新增功能，对齐Android实现）==========
(function () {
  if (window.__http_hook_loaded__) return;
  window.__http_hook_loaded__ = true;

  var MAX_BODY_SIZE = 1024 * 1024; // 1MB

  // Fetch Hook
  var OFetch = window.fetch;
  if (OFetch) {
    window.fetch = async function (input, init) {
      var url = typeof input === 'string' ? input : input.url;
      var method = init?.method || 'GET';

      notify({ t: 'http_request', u: url, ts: Date.now(), d: { method: method } });

      try {
        var response = await OFetch.apply(this, arguments);
        var cloned = response.clone();
        var contentLength = response.headers.get('content-length');

        if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
          notify({
            t: 'http_response',
            u: url,
            ts: Date.now(),
            d: {
              status: response.status,
              body: '[too large]'
            }
          });
        } else {
          try {
            var body = await cloned.text();
            notify({
              t: 'http_response',
              u: url,
              ts: Date.now(),
              d: {
                status: response.status,
                body: body
              }
            });
          } catch (e) {
            notify({
              t: 'http_response',
              u: url,
              ts: Date.now(),
              d: {
                status: response.status,
                body: '[unreadable]'
              }
            });
          }
        }

        return response;
      } catch (e) {
        notify({ t: 'http_error', u: url, ts: Date.now(), d: { error: e.message } });
        throw e;
      }
    };
  }

  // XHR Hook
  var OXHR = window.XMLHttpRequest;
  if (OXHR) {
    function HookedXHR() {
      var xhr = new OXHR();
      var requestUrl = '';
      var requestMethod = '';

      var originalOpen = xhr.open;
      xhr.open = function (method, url) {
        requestMethod = method;
        requestUrl = url;
        return originalOpen.apply(this, arguments);
      };

      var originalSend = xhr.send;
      xhr.send = function (data) {
        if (requestUrl) {
          notify({
            t: 'http_request',
            u: requestUrl,
            ts: Date.now(),
            d: {
              method: requestMethod,
              body: data
            }
          });
        }
        return originalSend.apply(this, arguments);
      };

      xhr.addEventListener('load', function () {
        if (requestUrl) {
          var body = xhr.responseText || '[unreadable]';
          notify({
            t: 'http_response',
            u: requestUrl,
            ts: Date.now(),
            d: {
              status: xhr.status,
              body: body.length > MAX_BODY_SIZE ? '[too large]' : body
            }
          });
        }
      });

      xhr.addEventListener('error', function () {
        if (requestUrl) {
          notify({ t: 'http_error', u: requestUrl, ts: Date.now(), d: { error: 'XHR error' } });
        }
      });

      return xhr;
    }

    HookedXHR.prototype = OXHR.prototype;
    try {
      window.XMLHttpRequest = HookedXHR;
    } catch (e) {
      console.error('[Sniffer] Failed to hook XMLHttpRequest:', e);
    }
  }
})();
