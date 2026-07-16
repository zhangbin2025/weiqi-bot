/**
 * 跳转决策实现
 * @module application/assistant/JumpDecision
 */
import type { IJumpDecision, JumpDecisionResult, AlternativeIntent } from './IJumpDecision';
import type { IntentConfig } from '../../domain/intent/intent-config';
/**
 * 跳转决策器
 * 根据意图、置信度和实体决定是否自动跳转
 */
export class JumpDecision implements IJumpDecision {
  /**
   * 获取跳转决策
   */
  getJumpDecision(
    intent: string,
    confidence: number,
    entities: Record<string, any>,
    alternatives?: AlternativeIntent[]
  ): JumpDecisionResult {
    // 1. 特殊规则优先（URL、棋手姓名、野狐昵称等）：高置信度，3秒倒计时
    const highConfidenceIntents = [
      'query_player',
      'download_game',
      'analyze_opponent',
      'start_recorder',
      'start_replay',
      'start_joseki',
    ];
    if (highConfidenceIntents.includes(intent)) {
      if (intent === 'query_player' && entities['player']) {
        return { shouldJump: true, countdown: 3, showAlternatives: false };
      }
      if (intent === 'download_game' && entities['url']) {
        return { shouldJump: true, countdown: 3, showAlternatives: false };
      }
      if (intent === 'analyze_opponent' && entities['player']) {
        return { shouldJump: true, countdown: 3, showAlternatives: false };
      }
      if (intent === 'start_recorder') {
        return { shouldJump: true, countdown: 3, showAlternatives: false };
      }
      if (intent === 'start_replay' && entities['sgf']) {
        return { shouldJump: true, countdown: 3, showAlternatives: false };
      }
      if (intent === 'start_joseki') {
        return { shouldJump: true, countdown: 3, showAlternatives: false };
      }
    }
    // 2. 中等置信度意图
    const mediumConfidenceIntents = [
      'start_play',
      'start_joseki_quiz',
      'explore_joseki',
      'discover_joseki',
      'generate_decision',
      'search_event',
      'start_review',
    ];
    // 3. 特殊处理：做题相关意图（定式挑战 vs 实战选点）
    const quizIntents = ['start_joseki_quiz', 'generate_decision'];
    if (quizIntents.includes(intent) && alternatives && alternatives.length > 0) {
      const hasOtherQuizIntent = alternatives.some(alt => quizIntents.includes(alt.intent));
      if (hasOtherQuizIntent) {
        // 如果候选中有另一个做题意图，显示候选让用户选择
        const gapToSecond = confidence - alternatives[0]!.confidence;
        if (gapToSecond < 0.1) {
          // 差距不是特别大（< 0.1）时显示候选
          return { shouldJump: false, countdown: 0, showAlternatives: true };
        }
      }
    }
    // 4. 检查是否应该显示候选
    if (alternatives && alternatives.length > 0 && mediumConfidenceIntents.includes(intent)) {
      const topConfidence = confidence;
      const secondConfidence = alternatives[0]!.confidence;
      const gapToSecond = topConfidence - secondConfidence;
      // 计算候选之间的平均差距（聚集程度）
      if (alternatives.length >= 2) {
        let candidateGapSum = 0;
        let candidateGapCount = 0;
        for (let i = 0; i < alternatives.length - 1; i++) {
          const gap = alternatives[i]!.confidence - alternatives[i + 1]!.confidence;
          candidateGapSum += gap;
          candidateGapCount++;
        }
        const avgCandidateGap = candidateGapCount > 0 ? candidateGapSum / candidateGapCount : 0;
        // 如果命中远离候选群体（差距 > 候选聚集程度 * 3倍），直接跳转
        if (gapToSecond > avgCandidateGap * 3 && gapToSecond > 0.01) {
          return { shouldJump: true, countdown: 5, showAlternatives: false };
        }
      }
      // 如果候选差距非常小（< 0.02），显示候选
      if (gapToSecond < 0.02) {
        return { shouldJump: false, countdown: 0, showAlternatives: true };
      }
    }
    // 5. 如果意图在中等置信度列表中，直接跳转
    if (mediumConfidenceIntents.includes(intent)) {
      return { shouldJump: true, countdown: 5, showAlternatives: false };
    }
    // 6. 默认：不自动跳转
    return { shouldJump: false, countdown: 0, showAlternatives: false };
  }
  /**
   * 构建跳转 URL
   */
  buildJumpUrl(
    intent: string,
    entities: Record<string, any>,
    config: IntentConfig
  ): string {
    // 构建 URL
    let targetPath = config.path;
    // 特殊处理对弈模式
    if (intent === 'start_play' && entities['mode'] === 'hh') {
      targetPath = '../play/hh.html';
    } else if (intent === 'start_play' && entities['mode'] === 'hm') {
      targetPath = '../play/hm.html';
    } else if (intent === 'start_play' && entities['mode'] === 'mm') {
      targetPath = '../play/mm.html';
    }
    const url = new URL(targetPath, window.location.href);
    // 添加参数
    for (const [key, value] of Object.entries(entities)) {
      if (config.params.includes(key)) {
        url.searchParams.append(key, value as string);
      }
    }
    // 添加自动执行标记（只对特定意图）
    const autoIntents = ['query_player', 'download_game', 'analyze_opponent', 'search_event', 'generate_decision', 'discover_joseki'];
    if (autoIntents.includes(intent)) {
      url.searchParams.append('auto', 'true');
    }
    return url.toString();
  }
}
