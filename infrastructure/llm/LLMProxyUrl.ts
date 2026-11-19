/**
 * LLM 请求的代理地址注册表
 * @module infrastructure/llm/LLMProxyUrl
 *
 * 背景：部分 OpenAI 兼容端点（如 tokenhub.tencentmaas.com/plan/v3）完全不支持
 * CORS —— OPTIONS 预检直接 405、响应里没有 Access-Control-Allow-Origin。
 * 浏览器对「跨域 + Authorization + application/json」的 POST 必须先发预检，
 * 于是纯前端直连 fetch 无论如何都过不去（改 headers / mode / no-cors 都无效）。
 *
 * 项目其余业务 API 早就用同一套反向代理解决跨域：前端只请求
 * `${proxyUrl}/?url=<encodeURIComponent(目标)>`，由代理服务端发 POST、透传
 * Authorization 与 body、回 Access-Control-Allow-Origin。三端代理都实测能正确
 * 转发 LLM 请求：
 * - 纯 Web：https://api.weiqi.lol（Cloudflare Worker，预检 200 + ACAO:*）
 * - Android：本地 AssetServer / ProxyHandler（OkHttp 转发 POST + authorization）
 * - 桌面：本地 AssetServer（http.request 转发 POST + authorization）
 * Android / 桌面的本地代理与页面同源；桌面 onBeforeRequest 对本地地址第一批放行，
 * 不会被 redirectURL 降级成 GET（这正是历史上 LLM 必须直连的原因，现已不适用）。
 *
 * 为什么用模块级注册而不是给每个 client 传构造参数：
 * - proxyUrl 由 vite 域的 resolveProxyUrl() 解析（含 import.meta.env 与 App 桥接），
 *   而 OpenAICompatibleClient / OpenAIModelGateway / LLMIntentProvider 都在根
 *   tsconfig 的 tsc 依赖图内，不能引用 import.meta.env，也不能反向依赖 vite 域。
 * - proxyUrl 是「运行环境属性」：整页一次解析、生命周期内不变，不是每个 client
 *   实例各异的配置。由页面入口登记一次、LLM 层读取，不必改动 PluginSystem /
 *   ChatUseCase / SkillRouter 等中间层，也不用改 IModelGateway 抽象。
 *
 * 为什么登记的是 Promise 而不是已解析的字符串：
 * - 入口不必 await —— App 端 window.prompt('config:get') 是原生桥接，不该让
 *   页面初始化（尤其输入按钮）等它回来；
 * - LLM 请求侧 await 同一个 Promise —— 无论解析多慢，第一次请求都不会先于
 *   注入发出，彻底消除「用户手快发了一条消息 → 走了直连 → CORS 报错」的竞态。
 * - 纯 Web 分支没有 await，本质是一个已 resolve 的 Promise，开销只有一个微任务。
 *
 * 失败语义：resolveProxyUrl() 内部对 App 桥接失败已回落到 8088 本地代理，
 * 纯 Web 分支同步返回常量，正常不会 reject。万一入口传入的 Promise reject，
 * 这里**不吞成直连** —— 纯 Web 回落直连等于必崩 CORS，静默降级只会把问题
 * 藏起来。结果对象里保存失败原因，由第一次 LLM 请求抛出一条清楚的错误；
 * 同时避免「没有任何请求时挂在注册表里的 reject Promise」变成 unhandledRejection。
 *
 * 本文件保持纯 tsc 域（不 import 任何 vite 域文件）。未登记时（单元测试、CLI、
 * 非 Web 宿主）保持直连，行为与改动前逐字一致。
 */

type ProxyResolution =
  | { ok: true; proxyUrl?: string }
  | { ok: false; error: unknown };

let resolution: Promise<ProxyResolution> | undefined;

/**
 * 由页面入口登记代理地址。接受字符串或 Promise<string>（resolveProxyUrl 的返回值）。
 * 传 undefined / 空串表示不启用代理（直连）。幂等：后登记覆盖先登记。
 */
export function installLLMProxy(url: string | undefined | Promise<string | undefined>): void {
  resolution = Promise.resolve(url).then(
    // exactOptionalPropertyTypes：只在有值时带该字段，不写 proxyUrl: undefined
    (proxyUrl): ProxyResolution => (proxyUrl
      ? { ok: true, proxyUrl }
      : { ok: true }),
    (error: unknown): ProxyResolution => ({ ok: false, error }),
  );
}

/** 仅供单元测试清理全局状态，生产代码不要调用。 */
export function resetLLMProxyUrl(): void {
  resolution = undefined;
}

/** 当前是否登记了代理解析（供状态展示 / 诊断使用）。 */
export function hasLLMProxyUrl(): boolean {
  return resolution !== undefined;
}

/**
 * 把 chat/completions 端点解析成实际 fetch 的 URL。
 *
 * 走代理时按项目既有口径拼接，与 WebFetchTool / ResourceInput 逐字一致：
 * 代理地址不带尾斜杠（resolveProxyUrl 三端返回值都不带），目标端点整体
 * encodeURIComponent 后放进 ?url=，代理服务端负责解码并发起 POST。
 * encodeURIComponent 是 URL 编码规范，不是可调阈值。
 *
 * @param endpoint buildChatCompletionsUrl() 得到的绝对 URL
 */
export async function resolveLLMRequestUrl(endpoint: string): Promise<string> {
  if (!resolution) return endpoint;
  const result = await resolution;
  if (!result.ok) {
    throw new Error('LLM 代理地址解析失败，无法发起请求；请刷新页面重试');
  }
  if (result.proxyUrl === undefined) return endpoint;
  return `${result.proxyUrl}/?url=${encodeURIComponent(endpoint)}`;
}
