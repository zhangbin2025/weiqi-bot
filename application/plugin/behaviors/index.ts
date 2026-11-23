/**
 * 扩展点行为注册表（装配根唯一需要维护的业务接线点）
 * @module application/plugin/behaviors
 *
 * 宿主框架只读这张表并按 pointId 查表分派；ranking / workflow-operator 在这里平级注册。
 * 未来新增扩展点（例如 sgf fetcher）只需在这里加一条行为配方，不必改框架三文件。
 */

import type { ExtensionPointBehaviorRegistry } from '@domain/plugin/ExtensionPointBehavior';
import { RANKING_POINT_ID, WORKFLOW_OPERATOR_POINT_ID } from '@domain/plugin/types';
import { rankingBehavior } from './RankingBehavior';
import { operatorBehavior } from './OperatorBehavior';

/** 返回一份新的按 pointId 索引的行为注册表 */
export function createExtensionPointBehaviors(): ExtensionPointBehaviorRegistry {
  return {
    [RANKING_POINT_ID]: rankingBehavior,
    [WORKFLOW_OPERATOR_POINT_ID]: operatorBehavior,
  };
}

export { rankingBehavior, RANKING_CONTRACT_LINES } from './RankingBehavior';
export { operatorBehavior, OPERATOR_DEV_LINES, OPERATOR_CONTRACT_HINT } from './OperatorBehavior';
