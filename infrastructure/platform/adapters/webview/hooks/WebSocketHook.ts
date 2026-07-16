/**
 * WebSocket Hook 注入脚本
 * 
 * 覆盖原生 WebSocket，拦截所有消息
 */

/**
 * WebSocket Hook 注入脚本
 */
export const WEBSOCKET_HOOK_SCRIPT = `
(function() {
  if (window.__WS_HOOKED__) return;
  
  const OriginalWebSocket = window.WebSocket;
  window.__WS_HOOKED__ = true;
  window.__WS_MESSAGES__ = [];
  
  window.WebSocket = function(url, protocols) {
    console.log('[WS Hook] Creating:', url);
    const ws = new OriginalWebSocket(url, protocols);
    
    // Hook receive
    ws.addEventListener('message', function(event) {
      const msg = {
        url: url,
        direction: 'receive',
        data: event.data,
        timestamp: Date.now()
      };
      window.__WS_MESSAGES__.push(msg);
      
      // 发送回原生
      const payload = JSON.stringify({ type: 'ws_message', data: msg });
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(payload);
      }
      if (window.wx && window.wx.miniProgram) {
        window.wx.miniProgram.postMessage({ data: payload });
      }
    });
    
    // Hook send
    const originalSend = ws.send;
    ws.send = function(data) {
      const msg = {
        url: url,
        direction: 'send',
        data: String(data),
        timestamp: Date.now()
      };
      window.__WS_MESSAGES__.push(msg);
      
      const payload = JSON.stringify({ type: 'ws_send', data: msg });
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(payload);
      }
      
      return originalSend.call(this, data);
    };
    
    return ws;
  };
  
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  
  console.log('[WS Hook] Initialized');
})();
`;

/**
 * 提取 WebSocket 消息的脚本
 */
export const EXTRACT_WS_MESSAGES = `
(function() {
  return window.__WS_MESSAGES__ || [];
})();
`;

/**
 * 清空 WebSocket 消息缓存
 */
export const CLEAR_WS_MESSAGES = `
(function() {
  window.__WS_MESSAGES__ = [];
})();
`;
