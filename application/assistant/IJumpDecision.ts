/**
 * 跳转决策接口
 * @module application/assistant/IJumpDecision
 */
import type { IntentConfig } from '../../domain/intent/intent-config';
/**
 * 跳转决策结果
 */
export interface JumpDecisionResult {
  /** 是否应该自动跳转 */
  shouldJump: boolean;
  /** 倒计时秒数 */
  countdown: number;
  /** 是否显示候选意图 */
  showAlternatives: boolean;
}
/**
 * 候选意图
 */
export interface AlternativeIntent {
  intent: string;
  confidence: number;
}
/**
 * 跳转决策接口
 * 根据意图、置信度和实体决定是否自动跳转
 */
export interface IJumpDecision {
  /**
   * 获取跳转决策
   * @param intent 识别出的意图
   * @param confidence 置信度
   * @param entities 提取的实体
   * @param alternatives 候选意图列表
   * @returns 跳转决策结果
   * 
   * @ai-example
   * ```typescript
   * const decision = jumpDecision.getJumpDecision('query_player', 0.95, { player: '柯洁' });
   * // decision = { shouldJump: true, countdown: 3, showAlternatives: false }
   * ```
   */
  getJumpDecision(
    intent: string,
    confidence: number,
    entities: Record<string, any>,
    alternatives?: AlternativeIntent[]
  ): JumpDecisionResult;
  /**
   * 构建跳转 URL
   * @param intent 意图
   * @param entities 实体
   * @param config 意图配置
   * @returns 完整的跳转 URL
   * 
   * @ai-example
   * ```typescript
   * const url = jumpDecision.buildJumpUrl('query_player', { player: '柯洁' }, config);
   * // url = '../player/index.html?player=柯洁&auto=true'
   * ```
   */
  buildJumpUrl(
    intent: string,
    entities: Record<string, any>,
    config: IntentConfig
  ): string;
}
