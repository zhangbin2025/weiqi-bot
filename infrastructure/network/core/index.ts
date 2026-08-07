/**
 * 核心逻辑导出
 */

export { ProviderRegistry } from './ProviderRegistry';
export { EnvironmentDetector } from './EnvironmentDetector';
export { DefaultNetworkStrategy } from './DefaultNetworkStrategy';
export { NetworkManager } from './NetworkManager';
export { PluginOperations } from './PluginOperations';
export { ConnectionOperations } from './ConnectionOperations';
export { PluginManager } from './PluginManager';
export { applyNetworkConfigDefaults } from './NetworkConfigDefaults';
export { createNetworkManager } from './NetworkManagerFactory';
export { PLAYWRIGHT_PLATFORMS, REST_API_PLATFORMS } from './PlatformConstants';

// 从 Config 模块导出 Network 配置接口
export type { INetworkConfig } from '../../config/schemas/NetworkConfigSchema';
