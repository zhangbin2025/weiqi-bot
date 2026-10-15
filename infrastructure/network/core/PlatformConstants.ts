/**
 * Playwright 平台列表
 */
export const PLAYWRIGHT_PLATFORMS = [
  'txwq.qq.com',
  'h5.txwq.qq.com',
  'yikeweiqi.com/game',
  '1919weiqi.com',
  'izis.cn',
  'xinboduiyi.com',
  'shaoer.yikeweiqi.com'
];

/**
 * REST API 平台列表
 */
export const REST_API_PLATFORMS = [
  'foxwq.com',
  'online-go.com',
  '101weiqi.com',
  'dzqzd.com',      // 手谈
  'eweiqi.com',     // 弈城
  'yuanluobo.com',  // 元萝卜
  'api.weiqi.lol',  // 代理/API 服务器
  'bot.weiqi.lol',  // 静态资源服务器
  'yichafen.com',   // 易查分
];

/**
 * 已验证支持跨域直连的站点（Web 环境可绕过代理）
 *
 * 列入条件（缺一不可）：
 * 1. 响应携带 access-control-allow-origin: *（或覆盖本站 Origin）
 * 2. 预检 OPTIONS 允许实际请求所需的方法与请求头
 * 3. 该站点的接口无需鉴权 Cookie / 真实客户端 IP
 *
 * 实测记录（2026-10-15，online-go.com）：
 *   GET  /api/v1/puzzles/ → access-control-allow-origin: *
 *   OPTIONS 预检 → allow-methods 含 GET，allow-headers 含 accept、user-agent
 *   即 OgsPuzzleProvider 实际发送的 `Accept` + `User-Agent` 不会触发预检失败。
 *
 * 收益：少一跳代理（实测 0.85~1.9s 直连 vs 0.98~1.29s 经代理），
 *       并消除代理隧道抖动带来的 ERR_TUNNEL_CONNECTION_FAILED。
 *
 * ⚠️ 新增站点前必须实测上述三项，否则会把请求推到必然失败的直连路径上。
 */
export const CORS_VERIFIED_DIRECT_HOSTS = [
  'online-go.com',
];

/**
 * 判断 URL 的主机是否命中已验证的跨域直连白名单
 *
 * 按主机名精确匹配（而非子串包含），避免 evil-online-go.com 这类绕过。
 * 子域名视为同源站点的一部分，一并放行（如 api.online-go.com）。
 *
 * @param url 待判定 URL；相对路径或无法解析时返回 false（保守走代理）
 */
export function isCorsVerifiedDirectHost(url?: string): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    // 相对路径交给 URL 解析会抛错，此处按 false 处理（保守走代理）
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return CORS_VERIFIED_DIRECT_HOSTS.some(
    (host) => hostname === host || hostname.endsWith('.' + host)
  );
}
