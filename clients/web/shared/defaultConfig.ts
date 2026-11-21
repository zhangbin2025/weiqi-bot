/**
 * Web Shell 默认配置
 * @description 各模块的默认配置常量，供 Shell 使用
 *
 * proxyUrl 不在此定义：它由 WebBootstrap 用 resolveProxyUrl()（含用户在 /proxy
 * 里的覆盖值）统一注入每个模块配置。默认配置自带硬编码代理会被入口的
 * moduleConfigs 整体盖回，故这里不保留第二份代理默认值。
 *
 * 缓存默认口径：会变的查询结果（棋手、赛事）默认不缓存，避免网络异常时被
 * 固化成「查不到」、并在网络恢复后继续命中旧结果；确需缓存时由入口显式把
 * enable*Cache 设为 true（opt-in）。内容不变的资产（KataGo 模型权重）仍缓存。
 */

export const DEFAULT_GAME_CONFIG = {
  timeout: 30000,
  // 历史遗留字段，当前无读取方（棋谱归档缓存走独立的 GameArchiveCache）。
  // 置 false 以免被误读为「查询结果缓存已开启」。
  enableCache: false,
  maxHistorySize: 100,
};

export const DEFAULT_PLAYER_CONFIG = {
  shoutanBaseUrl: 'https://v.dzqzd.com/SpBody.aspx',
  yichafenBaseUrl: '',
  timeout: 300000, // 5 分钟
  playerCacheTTL: 3600000,
  // 棋手信息会变，默认不缓存查询结果（opt-in 才启用）
  enablePlayerCache: false,
};

export const DEFAULT_EVENT_CONFIG = {
  eventsBaseUrl: 'https://data-center.yunbisai.com/api/lswl-events',
  groupsBaseUrl: 'https://open.yunbisai.com/api/event/feel/list',
  againstPlanBaseUrl: 'https://api.yunbisai.com/request/Group/Againstplan',
  eventpartBaseUrl: 'https://api.yunbisai.com/request/Group/Eventpart',
  timeout: 30000,
  eventCacheTTL: 1800000,
  // 赛事对阵会变，默认不缓存查询结果（opt-in 才启用）
  enableEventCache: false,
};

export const DEFAULT_MANAGEMENT_CONFIG = {
  // versionUrl 由 ManagementService 根据环境自动判断：
  // - Web 环境使用相对路径（支持子目录部署）
  // - App 环境使用本地路径
  versionUrl: '',
  timeout: 30000,
};
