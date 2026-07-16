// content-script.js - WebExtension content script for WebSocket and HTTP sniffing
// Strategy: inject <script> tag into PAGE main world (no wrappedJSObject / exportFunction).
// Page-world hook posts events via window.postMessage; this content script forwards
// them to the native app over runtime.connectNative.
//
// Runs @ document_start via manifest.json content_scripts configuration.

(function () {
    'use strict';

    if (window.__ws_sniffer_cs__) return;
    window.__ws_sniffer_cs__ = true;

    // ---------- native messaging ----------
    var port = null;
    var queue = [];
    var flushTimer = null;
    var FLUSH_INTERVAL = 100;
    var connectAttempts = 0;
    var MAX_CONNECT_ATTEMPTS = 40;        // 40 * 200ms = 8s
    var RECONNECT_INTERVAL = 200;
    var connectTimer = null;

    function connect() {
        if (port) return;
        connectAttempts++;
        try {
            port = browser.runtime.connectNative('browser');
            port.onDisconnect.addListener(function () {
                port = null;
                scheduleReconnect();
            });
            // 连上之后立刻把积压数据吐出去
            if (queue.length) scheduleFlush();
        } catch (e) {
            port = null;
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (port) return;
        if (connectAttempts >= MAX_CONNECT_ATTEMPTS) {
            try { console.error('[WS Sniffer] giving up native connect after ' + connectAttempts + ' attempts'); } catch (e) {}
            return;
        }
        if (connectTimer) return;
        connectTimer = setTimeout(function () {
            connectTimer = null;
            connect();
        }, RECONNECT_INTERVAL);
    }

    function flush() {
        if (!queue.length) return;
        if (!port) {
            scheduleReconnect();
            return;
        }
        var batch = queue.splice(0, queue.length);
        try {
            port.postMessage({ wsEvents: batch });
        } catch (e) {
            queue = batch.concat(queue);
            port = null;
            scheduleReconnect();
        }
    }

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(function () {
            flushTimer = null;
            flush();
        }, FLUSH_INTERVAL);
    }

    connect();

    // 兜底：抑制 GeckoView 内部 connectNative 异步异常产生的
    // "uncaught exception: undefined" 日志噪音
    try {
        self.addEventListener('unhandledrejection', function (e) {
            try { e.preventDefault(); } catch (_) {}
        });
    } catch (e) { /* ignore */ }

    // ---------- bridge: page world -> content script ----------
    window.addEventListener('message', function (e) {
        if (e.source !== window) return;
        var d = e.data;
        if (!d || d.__wsSnifferTag !== 'ws-sniffer@weiqi.app') return;
        var p = d.payload;
        if (!p) return;
        queue.push(p);
        // Close events flush immediately so we don't lose tail data.
        if (p.t === 'close' || p.t === 'error' || p.t === 'ws_close' || p.t === 'ws_error') {
            flush();
        } else {
            scheduleFlush();
        }
    }, false);

    // ---------- inject hook into PAGE main world ----------
    // Stringified so it executes in the page's JS context, not the isolated CS world.
    function pageHook() {
        if (window.__ws_sniffer_page__) return;
        window.__ws_sniffer_page__ = true;

        var TAG = 'ws-sniffer@weiqi.app';
        
        // ========== 事件上报 ==========
        function post(type, url, data) {
            try {
                window.postMessage({
                    __wsSnifferTag: TAG,
                    payload: { t: type, u: url, d: data, ts: Date.now() }
                }, '*');
            } catch (e) { /* ignore */ }
        }

        // ========== WebSocket Hook ==========
        (function () {
            var OWS = window.WebSocket;
            if (!OWS) {
                try { console.warn('[WS Sniffer] page: WebSocket missing'); } catch (e) {}
                return;
            }

            function WSSniffer(url, protocols) {
                var ws = protocols ? new OWS(url, protocols) : new OWS(url);

                post('ws_open', url, null);

                try {
                    var origSend = ws.send.bind(ws);
                    ws.send = function (data) {
                        var payload;
                        if (typeof data === 'string') {
                            payload = data;
                        } else {
                            payload = '[bin]';
                        }
                        post('ws_send', url, payload);
                        return origSend(data);
                    };
                } catch (e) { /* ignore */ }

                ws.addEventListener('message', function (ev) {
                    var payload;
                    if (typeof ev.data === 'string') {
                        payload = ev.data;
                    } else {
                        payload = '[bin]';
                    }
                    post('ws_receive', url, payload);
                });

                ws.addEventListener('close', function (ev) {
                    post('ws_close', url, { code: ev.code, reason: ev.reason || '' });
                });

                ws.addEventListener('error', function () {
                    post('ws_error', url, null);
                });

                return ws;
            }

            // Preserve prototype chain and static constants.
            WSSniffer.prototype = OWS.prototype;
            try {
                ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
                    Object.defineProperty(WSSniffer, k, {
                        value: OWS[k],
                        writable: false,
                        configurable: true,
                        enumerable: true
                    });
                });
            } catch (e) { /* ignore */ }

            try {
                window.WebSocket = WSSniffer;
            } catch (e) { /* ignore */ }
        })();

        // ========== HTTP Hook ==========
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

                    post('http_request', url, { method: method });

                    try {
                        var response = await OFetch.apply(this, arguments);
                        var cloned = response.clone();
                        var contentLength = response.headers.get('content-length');

                        if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
                            post('http_response', url, {
                                status: response.status,
                                body: '[too large]'
                            });
                        } else {
                            try {
                                var body = await cloned.text();
                                post('http_response', url, {
                                    status: response.status,
                                    body: body
                                });
                            } catch (e) {
                                post('http_response', url, {
                                    status: response.status,
                                    body: '[unreadable]'
                                });
                            }
                        }

                        return response;
                    } catch (e) {
                        post('http_error', url, { error: e.message });
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
                            post('http_request', requestUrl, {
                                method: requestMethod,
                                body: data
                            });
                        }
                        return originalSend.apply(this, arguments);
                    };

                    xhr.addEventListener('load', function () {
                        if (requestUrl) {
                            var body = xhr.responseText || '[unreadable]';
                            post('http_response', requestUrl, {
                                status: xhr.status,
                                body: body.length > MAX_BODY_SIZE ? '[too large]' : body
                            });
                        }
                    });

                    xhr.addEventListener('error', function () {
                        if (requestUrl) {
                            post('http_error', requestUrl, { error: 'XHR error' });
                        }
                    });

                    return xhr;
                }

                HookedXHR.prototype = OXHR.prototype;
                try {
                    window.XMLHttpRequest = HookedXHR;
                } catch (e) { /* ignore */ }
            }
        })();
    }

    function inject() {
        try {
            var s = document.createElement('script');
            // Inline source executes synchronously in the page's main world.
            s.textContent = '(' + pageHook.toString() + ')();';
            var parent = document.documentElement || document.head || document.body;
            if (!parent) return false;
            parent.appendChild(s);
            // Remove the node; the function has already run.
            if (s.parentNode) s.parentNode.removeChild(s);
            return true;
        } catch (e) {
            try { console.error('[WS Sniffer] inject failed:', e && e.message); } catch (_) {}
            return false;
        }
    }

    if (!inject()) {
        // documentElement not yet available; retry on DOMContentLoaded.
        document.addEventListener('DOMContentLoaded', inject, { once: true });
    }
})();
