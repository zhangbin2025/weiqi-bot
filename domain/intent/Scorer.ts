/**
 * 意图评分器
 */

import { IntentConfig } from './types';
import { WEIQI_VOCABULARY } from './IntentConfig';
import { calculateCharSimilarity } from './CharSimilarity';

/**
 * 权重配置
 */
const WEIGHTS = {
  keywordMatch: 0.5,    // 提高：关键词匹配更重要
  wordMatch: 0.35,      // 略微提高：分词匹配
  charSimilarity: 0.15, // 降低：字符相似度权重
};

/**
 * 评分结果
 */
export interface ScoreResult {
  config: IntentConfig;
  score: number;
  matchedKeywords: string[];
}

/**
 * 计算所有意图的得分
 */
export function calculateAllScores(
  text: string,
  intents: IntentConfig[]
): ScoreResult[] {
  const allScores: ScoreResult[] = [];

  for (const config of intents) {
    const result = calculateIntentScore(text, config);
    if (result.score > 0) {
      allScores.push(result);
    }
  }

  return allScores;
}

/**
 * 计算单个意图的得分
 */
function calculateIntentScore(text: string, config: IntentConfig): ScoreResult {
  const keywordScore = calculateKeywordScore(text, config);
  const charScore = calculateCharSimilarity(text, config) * 100;
  const wordScore = calculateWordScore(text, config.intent);

  const totalScore =
    keywordScore * WEIGHTS.keywordMatch +
    wordScore * WEIGHTS.wordMatch +
    charScore * WEIGHTS.charSimilarity;

  const matchedKeywords = getMatchedKeywords(text, config);

  return {
    config,
    score: totalScore,
    matchedKeywords,
  };
}

/**
 * 计算关键词得分
 */
function calculateKeywordScore(text: string, config: IntentConfig): number {
  let score = 0;

  for (const keyword of config.coreKeywords) {
    if (text.includes(keyword) || keyword.includes(text)) {
      score += 15; // 提高得分：从 10 提高到 15
    }
  }

  if (config.variantKeywords) {
    for (const keyword of config.variantKeywords) {
      if (text.includes(keyword) || keyword.includes(text)) {
        score += 12; // 提高得分：从 8 提高到 12
      }
    }
  }

  return score;
}

/**
 * 计算分词匹配得分
 */
function calculateWordScore(text: string, intent: string): number {
  let score = 0;

  for (const [word, intents] of Object.entries(WEIQI_VOCABULARY.actions)) {
    if (text.includes(word) && intents.includes(intent)) {
      score += 10;
    }
  }

  for (const [word, intents] of Object.entries(WEIQI_VOCABULARY.objects)) {
    if (text.includes(word) && intents.includes(intent)) {
      score += 10;
    }
  }

  return score;
}

/**
 * 获取匹配的关键词
 */
function getMatchedKeywords(text: string, config: IntentConfig): string[] {
  const matched: string[] = [];

  for (const keyword of config.coreKeywords) {
    if (text.includes(keyword) || keyword.includes(text)) {
      matched.push(keyword);
    }
  }

  if (config.variantKeywords) {
    for (const keyword of config.variantKeywords) {
      if (text.includes(keyword) || keyword.includes(text)) {
        matched.push(keyword);
      }
    }
  }

  return matched;
}
