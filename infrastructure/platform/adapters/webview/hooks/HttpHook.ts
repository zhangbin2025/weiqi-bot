/**
 * HTTP/Fetch Hook 注入脚本
 * 
 * 拦截 fetch 和 XMLHttpRequest 请求
 */

/**
 * HTTP Hook 注入脚本
 */
export const HTTP_HOOK_SCRIPT = `
(function() {
  if (window.__HTTP_HOOKED__) return;
  window.__HTTP_HOOKED__ = true;
  window.__HTTP_RESPONSES__ = [];
  
  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    const method = options?.method || 'GET';
    
    return originalFetch.apply(this, arguments).then(async function(response) {
      const cloned = response.clone();
      const body = await cloned.text();
      
      const data = {
        url: url.toString(),
        method: method,
        status: response.status,
        headers: {},
        body: body,
        timestamp: Date.now()
      };
      
      response.headers.forEach(function(v, k) {
        data.headers[k] = v;
      });
      
      window.__HTTP_RESPONSES__.push(data);
      
      const payload = JSON.stringify({ type: 'http_response', data: data });
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(payload);
      }
      if (window.wx && window.wx.miniProgram) {
        window.wx.miniProgram.postMessage({ data: payload });
      }
      
      return response;
    });
  };
  
  // Hook XMLHttpRequest
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    const reqData = { url: '', method: '' };
    
    const originalOpen = xhr.open;
    xhr.open = function(method, url) {
      reqData.method = method;
      reqData.url = url.toString();
      return originalOpen.apply(this, arguments);
    };
    
    const originalSend = xhr.send;
    xhr.send = function() {
      const self = this;
      this.addEventListener('load', function() {
        const data = {
          url: reqData.url,
          method: reqData.method,
          status: self.status,
          headers: {},
          body: self.responseText,
          timestamp: Date.now()
        };
        
        window.__HTTP_RESPONSES__.push(data);
        
        const payload = JSON.stringify({ type: 'http_response', data: data });
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(payload);
        }
      });
      
      return originalSend.apply(this, arguments);
    };
    
    return xhr;
  };
  
  console.log('[HTTP Hook] Initialized');
})();
`;

/**
 * 提取 HTTP 响应的脚本
 */
export const EXTRACT_HTTP_RESPONSES = `
(function() {
  return window.__HTTP_RESPONSES__ || [];
})();
`;

/**
 * 清空 HTTP 响应缓存
 */
export const CLEAR_HTTP_RESPONSES = `
(function() {
  window.__HTTP_RESPONSES__ = [];
})();
`;
