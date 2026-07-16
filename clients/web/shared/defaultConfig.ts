/**
 * Web Shell 默认配置
 * @description 各模块的默认配置常量，供 Shell 使用
 */

export const DEFAULT_GAME_CONFIG = {
  proxyUrl: import.meta.env.VITE_PROXY_URL || 'https://api.weiqi.lol',
  timeout: 30000,
  enableCache: true,
  maxHistorySize: 100,
};

export const DEFAULT_PLAYER_CONFIG = {
  proxyUrl: import.meta.env.VITE_PROXY_URL || 'https://api.weiqi.lol',
  shoutanBaseUrl: 'https://v.dzqzd.com/SpBody.aspx',
  yichafenBaseUrl: '',
  timeout: 300000, // 5 分钟
  playerCacheTTL: 3600000,
  enablePlayerCache: true,
};

export const DEFAULT_EVENT_CONFIG = {
  proxyUrl: import.meta.env.VITE_PROXY_URL || 'https://api.weiqi.lol',
  eventsBaseUrl: 'https://data-center.yunbisai.com/api/lswl-events',
  groupsBaseUrl: 'https://open.yunbisai.com/api/event/feel/list',
  againstPlanBaseUrl: 'https://api.yunbisai.com/request/Group/Againstplan',
  timeout: 30000,
  eventCacheTTL: 1800000,
  enableEventCache: true,
};

export const DEFAULT_MANAGEMENT_CONFIG = {
  proxyUrl: import.meta.env.VITE_PROXY_URL || 'https://api.weiqi.lol',
  // versionUrl 由 ManagementService 根据环境自动判断：
  // - Web 环境使用相对路径（支持子目录部署）
  // - App 环境使用本地路径
  versionUrl: '',
  timeout: 30000,
};
