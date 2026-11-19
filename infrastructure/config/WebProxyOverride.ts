/**
 * 纯 Web 代理地址的用户覆盖值（localStorage）。
 * @module infrastructure/config/WebProxyOverride
 *
 * 语义：这是「用户数据」——在功能助手页用 /proxy 设置后一直生效，只有用户
 * 主动 /proxy reset 或清除浏览器数据才回落环境默认。无过期、无自动回落。
 *
 * 只作用于纯 Web：是否读取这个值由 vite 域的 resolveProxyUrl() 决定（App /
 * 桌面分支在最前面短路，根本不读）。本文件保持纯 tsc 域，不碰 import.meta.env。
 *
 * 校验口径（都可复算、无经验阈值）：
 * - new URL() 标准解析，非法地址直接拒绝；
 * - scheme 只允许 http/https（代理服务端按此协议转发）；
 * - 去尾斜杠：项目拼接口径是 `${proxyUrl}/?url=`，带尾斜杠会变成 `//?url=`；
 * - 拒绝 userinfo / query / fragment：代理基础地址应是纯 origin(+path)，
 *   query 会与 `?url=` 拼接冲突，且能顺带挡住 `?token=...` 这类凭据明文落盘。
 */

const STORAGE_KEY = 'weiqi.web.proxy.override';

/** 归一化并校验用户输入的代理地址；返回去掉尾斜杠的原始串（保留大小写）。 */
export function normalizeProxyUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('代理地址必须是完整的 http(s) URL，例如 https://api.weiqi.lol');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('代理地址只支持 http:// 或 https://');
  }
  if (url.username || url.password) {
    throw new Error('代理地址不允许携带用户名/密码');
  }
  if (url.search || url.hash) {
    throw new Error('代理地址不能带查询参数或片段（会与 /?url= 拼接口径冲突）');
  }
  return trimmed;
}

/** 读取当前覆盖值；未设置 / 环境无 localStorage / 值损坏时返回 null。 */
export function loadWebProxyOverride(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeProxyUrl(raw);
  } catch {
    return null;
  }
}

/** 写入并持久化覆盖值，返回归一化后的地址。 */
export function saveWebProxyOverride(input: string): string {
  const normalized = normalizeProxyUrl(input);
  localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

/** 用户主动清空覆盖值，之后回落环境默认代理。 */
export function clearWebProxyOverride(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
