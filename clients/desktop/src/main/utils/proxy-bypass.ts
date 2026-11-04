/**
 * 桌面端请求代理放行判定
 * @module clients/desktop/src/main/utils/proxy-bypass
 *
 * 背景：Electron 主进程用 webRequest.onBeforeRequest 把所有外部 http(s)
 * 请求 redirectURL 到本地 /proxy，用来绕业务 API（棋谱/野狐等）的 CORS。
 * 但 redirectURL 会把带 Authorization 的 POST 降级成 GET（302 语义），
 * 请求头与 body 全丢 —— OpenAI 兼容 LLM 请求因此拿到云端 401
 * not authorized（「请求没携带授权信息」）。
 *
 * 让 LLM 请求「跟纯 web 一样」直连：命中 OpenAI 兼容 chat/completions
 * 端点的请求不再重定向，由渲染进程 fetch 直接打到云端。
 * 其余业务请求继续走本地代理，行为不变。
 */

/** 本地资产服务器端口（与主进程 config.localPort 一致） */
const LOCAL_SERVER_ORIGINS = [
  'http://127.0.0.1:8765',
  'http://localhost:8765',
];

/**
 * 是否为 OpenAI 兼容的 chat/completions 端点。
 * 兼容常见写法：
 *  - https://api.x.com/v1/chat/completions
 *  - https://api.x.com/chat/completions
 *  - https://api.lkeap.cloud.tencent.com/coding/v3/chat/completions
 * 用 pathname 判断，忽略 query（避免把带 ?url=... 的代理地址误判）。
 */
function isChatCompletionsEndpoint(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\/chat\/completions\/?$/.test(pathname);
  } catch {
    return false;
  }
}

/** 本地资产服务器请求（含 /proxy 自身），一律不走外部代理重定向 */
export function isLocalServerRequest(url: string): boolean {
  return LOCAL_SERVER_ORIGINS.some(origin => url.startsWith(origin));
}

/**
 * 判定该请求是否应「绕过本地代理、直接放行」。
 * 目前只有 LLM chat/completions 端点；本地请求单独在调用方处理。
 */
export function shouldBypassProxy(url: string): boolean {
  if (isLocalServerRequest(url)) return true;
  return isChatCompletionsEndpoint(url);
}
