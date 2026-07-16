/**
 * 后台任务必要参数检查器
 * @module domain/intent/BackgroundTaskChecker
 */

import { INTENT_CONFIG } from './intent-config';

/**
 * 检查是否满足后台任务的必要参数
 * @param intent 意图名称
 * @param entities 实体参数
 * @returns 是否满足必要参数
 */
export function checkRequiredParamsForBackground(
  intent: string,
  entities: Record<string, any>
): boolean {
  const config = INTENT_CONFIG[intent];
  
  // 如果没有配置 requiredParams，默认可以后台执行
  if (!config?.requiredParams || config.requiredParams.length === 0) {
    return true;
  }
  
  // 检查是否满足任一组必要参数（"或"的关系）
  for (const paramGroup of config.requiredParams) {
    // 检查该组参数是否都存在（"且"的关系）
    const hasAllParams = paramGroup.every(param => {
      const value = entities[param];
      return value !== undefined && value !== null && value !== '';
    });
    
    if (hasAllParams) {
      return true;  // 满足该组参数，可以后台执行
    }
  }
  
  return false;  // 不满足任何一组参数，不能后台执行
}
