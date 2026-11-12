/**
 * 解析当前运行环境应使用的代理地址
 * @module clients/web/shared/resolveProxyUrl
 *
 * 与 WebBootstrap / 对话页共用同一套三端分流口径（单一真相源）：
 * - 显式传入（options.proxyUrl）优先
 * - 原生 App（UA 含 WeiqiApp）：window.prompt('config:get') 取 localServerUrl，
 *   失败回退 Android 默认 8088
 * - 纯 Web：VITE_PROXY_URL 或线上 api.weiqi.lol
 *
 * 用户已明确：线上 api.weiqi.lol 只提供给纯 Web 端使用；Android / Windows
 * 客户端走自己的本地代理，不使用线上代理。
 *
 * 注：本文件与 defaultConfig.ts 同属 vite 处理域、不在根 tsconfig 的 tsc
 * 依赖图内。必须保持 `import.meta.env.VITE_PROXY_URL` 字面写法，vite 才能在
 * 编译期替换成 .env 里的值；不要改成类型断言/间接读取。
 */
export const DEFAULT_WEB_PROXY_URL = 'https://api.weiqi.lol';
export const DEFAULT_APP_PROXY_FALLBACK = 'http://localhost:8088/proxy';

export async function resolveProxyUrl(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')) {
    try {
      const raw = await window.prompt('config:get');
      const config = JSON.parse(raw!) as { localServerUrl?: string };
      if (config.localServerUrl) return `${config.localServerUrl}/proxy`;
    } catch {
      // Bridge 调用失败，回退到 Android 默认本地代理
    }
    return DEFAULT_APP_PROXY_FALLBACK;
  }
  return import.meta.env.VITE_PROXY_URL || DEFAULT_WEB_PROXY_URL;
}
