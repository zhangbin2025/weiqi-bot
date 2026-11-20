/**
 * 扩展点行为注册表（装配根唯一需要维护的业务接线点）
 * @module application/plugin/behaviors
 *
 * 宿主框架只读这张表并按 pointId 查表分派；ranking / llm-tool 在这里平级注册。
 * 未来新增扩展点（例如 sgf fetcher）只需在这里加一条行为配方，不必改框架三文件。
 */

import type { ExtensionPointBehaviorRegistry } from '@domain/plugin/ExtensionPointBehavior';
import { RANKING_POINT_ID, LLM_TOOL_POINT_ID } from '@domain/plugin/types';
import { rankingBehavior } from './RankingBehavior';
import { llmToolBehavior } from './LlmToolBehavior';

/** 返回一份新的按 pointId 索引的行为注册表 */
export function createExtensionPointBehaviors(): ExtensionPointBehaviorRegistry {
  return {
    [RANKING_POINT_ID]: rankingBehavior,
    [LLM_TOOL_POINT_ID]: llmToolBehavior,
  };
}

export { rankingBehavior, RANKING_CONTRACT_LINES } from './RankingBehavior';
export { llmToolBehavior, LLM_TOOL_DEV_LINES, LLM_TOOL_CONTRACT_HINT } from './LlmToolBehavior';
