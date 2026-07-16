/**
 * 意图识别器（主入口）
 */

import { RecognizeResult, ResponseType } from './types';
import { INTENT_KEYWORDS } from './IntentConfig';
import { SORTED_RULES } from './SpecialRules';
import { EntityExtractor, entityExtractor } from './EntityExtractor';
import { calculateAllScores, ScoreResult } from './Scorer';

/**
 * 置信度阈值（用于候选意图）
 */
const CONFIDENCE_THRESHOLD = 0.15;

/**
 * 响应类型识别模式
 */
const BACKGROUND_PATTERNS = ['后台', '后台查询', '后台搜索', '后台执行', '后台任务'];
const FOREGROUND_PATTERNS = ['打开', '查看', '看看', '显示', '进入', '手动'];
const PERIODIC_PATTERNS = ['每天', '每日', '每周', '定时', '定期'];
const DELAYED_PATTERN = /(\d+)小时后|(\d+)分钟后|(\d+)秒后/;

/**
 * 非线性置信度映射函数
 * 将分数映射到置信度，高分对应高置信度
 */
function scoreToConfidence(score: number): number {
  if (score >= 20) return 0.9;
  if (score >= 15) return 0.85;
  if (score >= 10) return 0.75;
  if (score >= 7) return 0.6;
  if (score >= 5) return 0.5;
  return Math.max(score / 10, 0.1); // 最低 0.1
}

/**
 * 意图识别器类
 */
export class IntentRecognizer {
  private extractor: EntityExtractor;

  constructor() {
    this.extractor = entityExtractor;
  }

  /**
   * 识别意图
   */
  recognize(text: string): RecognizeResult {
    const trimmed = text.trim();

    // 第一步：功能识别
    let result: RecognizeResult;
    
    // 第一层：特殊规则匹配
    const ruleResult = this.matchByRules(trimmed);
    if (ruleResult) {
      result = ruleResult;
    } else {
      // 第二层：多维度评分匹配
      const scoreResult = this.matchByScore(trimmed);
      if (scoreResult) {
        result = scoreResult;
      } else {
        // 第三层：默认 help
        result = {
          intent: 'help',
          confidence: 0.5,
          params: {},
        };
      }
    }
    
    // 第二步：响应类型识别
    const responseType = this.recognizeResponseType(trimmed);
    result.responseType = responseType;
    
    return result;
  }

  /**
   * 识别响应类型
   */
  private recognizeResponseType(text: string): ResponseType {
    // 1. 检测周期性任务关键词
    for (const pattern of PERIODIC_PATTERNS) {
      if (text.includes(pattern)) {
        return 'periodic';
      }
    }
    
    // 2. 检测后台任务关键词（用户明确要求后台）
    for (const pattern of BACKGROUND_PATTERNS) {
      if (text.includes(pattern)) {
        return 'background';
      }
    }
    
    // 3. 检测前台任务关键词（用户明确要求前台/打开页面）
    for (const pattern of FOREGROUND_PATTERNS) {
      if (text.includes(pattern)) {
        return 'foreground';
      }
    }
    
    // 4. 默认：根据环境自动决定（在 App 环境下会后台执行，其他环境前台执行）
    // 注意：返回 'foreground' 会导致在 App 环境下也被前台执行
    // 所以这里返回一个特殊值，让 AssistantUseCase 根据环境决定
    return 'foreground';
  }

  /**
   * 第一层：特殊规则匹配
   */
  private matchByRules(text: string): RecognizeResult | null {
    for (const rule of SORTED_RULES) {
      if (rule.match(text)) {
        const params = rule.extractParams ? rule.extractParams(text) : {};
        const entities = this.extractor.extract(text);
        const entityParams = this.extractor.toParams(entities);
        const finalParams = { ...entityParams, ...params };

        return {
          intent: rule.intent,
          confidence: 0.95,
          params: finalParams,
          matchedRule: rule.name,
        };
      }
    }
    return null;
  }

  /**
   * 第二层：多维度评分匹配
   */
  private matchByScore(text: string): RecognizeResult | null {
    // 优先检测精确匹配（文本完全等于某个 coreKeyword 或 variantKeyword）
    for (const config of INTENT_KEYWORDS) {
      // 检查 coreKeywords
      if (config.coreKeywords.includes(text)) {
        const entities = this.extractor.extract(text);
        const params = this.extractor.toParams(entities);
        return {
          intent: config.intent,
          confidence: 0.9,
          params,
          matchedKeywords: [text],
        };
      }
      // 检查 variantKeywords
      if (config.variantKeywords && config.variantKeywords.includes(text)) {
        const entities = this.extractor.extract(text);
        const params = this.extractor.toParams(entities);
        return {
          intent: config.intent,
          confidence: 0.85,
          params,
          matchedKeywords: [text],
        };
      }
    }

    const allScores = calculateAllScores(text, INTENT_KEYWORDS);

    if (allScores.length === 0) {
      return null;
    }

    // 按得分排序
    allScores.sort((a, b) => b.score - a.score);

    const best = allScores[0]!;
    
    // 如果最高得分低于阈值，返回 null（使用默认 help）
    if (best.score < 5) {
      return null;
    }
    
    // 使用非线性置信度映射
    const confidence = scoreToConfidence(best.score);

    // 生成候选意图
    const alternatives = this.generateAlternatives(allScores, confidence);

    // 提取参数
    const entities = this.extractor.extract(text, best.config.intent);
    const params = this.extractor.toParams(entities);

    const result: RecognizeResult = {
      intent: best.config.intent,
      confidence,
      params,
      matchedKeywords: best.matchedKeywords,
    };
    if (alternatives) {
      result.alternatives = alternatives;
    }
    return result;
  }

  /**
   * 生成候选意图列表
   */
  private generateAlternatives(
    allScores: ScoreResult[],
    topConfidence: number
  ): RecognizeResult['alternatives'] {
    const alternatives: RecognizeResult['alternatives'] = [];

    for (let i = 1; i < Math.min(allScores.length, 5); i++) {
      const current = allScores[i]!;
      // 使用非线性置信度映射
      const currentConfidence = scoreToConfidence(current.score);

      if (topConfidence - currentConfidence < CONFIDENCE_THRESHOLD) {
        alternatives.push({
          intent: current.config.intent,
          confidence: currentConfidence,
        });
      } else {
        break;
      }
    }

    return alternatives.length > 0 ? alternatives : undefined;
  }
}
