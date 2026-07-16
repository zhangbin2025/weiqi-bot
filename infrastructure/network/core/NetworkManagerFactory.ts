/**
 * 网络管理器工厂
 * @description 提供 NetworkManager 的创建方法
 */

import { NetworkManager } from './NetworkManager';
import type { ConfigManager } from '../../config/core/ConfigManager';
import type { INetworkConfig } from '../../config/schemas/NetworkConfigSchema';

/**
 * 从 ConfigManager 创建 NetworkManager 实例
 * @param configManager 配置管理器实例
 * @returns NetworkManager 实例
 */
export async function createNetworkManager(
  configManager: ConfigManager
): Promise<NetworkManager> {
  const config = await configManager.getModuleConfig<INetworkConfig>('network');
  return new NetworkManager(config);
}
