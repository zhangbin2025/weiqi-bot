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
 * 2026-11-19 更新：LLM 请求已改为「同源 /proxy?url=<端点>」——渲染进程
 * 不再直接 fetch 云端，由本地 AssetServer 转发 POST / Authorization / body。
 * 本地地址在 onBeforeRequest 第一批就放行，根本不会走到下面的重定向分支，
 * 302 降级问题随之消失。tokenhub 这类零 CORS 端点也因此可用。
 *
 * 下面这条直连特例仍然保留：旧版本页面 / 浏览器缓存里可能还有会直接 fetch
 * 云端 LLM 端点的 JS，删掉它反而会让那些请求被降级成 GET 拿 401。留着对新
 * 链路零影响（新请求是本地地址），对旧页面保持兼容。
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
 * 注：新链路请求的是本地 `http://127.0.0.1:8765/proxy/?url=...`，其 pathname
 * 是 `/proxy/`，不会被这里命中；本判定只服务于上述旧页面兼容。
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
