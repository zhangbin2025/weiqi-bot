/**
 * 定式探索配置模式
 * @description 定义定式探索服务的配置结构和默认值
 */

/**
 * 定式探索配置
 */
export interface IJosekiExploreConfig {
  /** 默认分析深度（visits） */
  defaultVisits: number;
  /** 默认候选点数 */
  defaultTopK: number;
  /** 默认贴目 */
  defaultKomi: number;
  /** 启用动态加载子节点 */
  enableDynamicLoad?: boolean;
}

/**
 * 定式探索配置默认值
 */
export const JosekiExploreConfigSchema: IJosekiExploreConfig = {
  defaultVisits: 100,
  defaultTopK: 5,
  defaultKomi: 7.5,
  enableDynamicLoad: false,
};