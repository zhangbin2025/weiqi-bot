/**
 * 字符级相似度计算
 */

import { IntentConfig } from './types';

/**
 * 计算两个字符串的 Jaccard 相似度
 */
export function jaccardSimilarity(str1: string, str2: string): number {
  const set1 = new Set(Array.from(str1));
  const set2 = new Set(Array.from(str2));
  
  const intersection = new Set(Array.from(set1).filter(x => set2.has(x)));
  const union = new Set([...Array.from(set1), ...Array.from(set2)]);
  
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * 计算文本与意图的字符级相似度
 */
export function calculateCharSimilarity(
  text: string,
  config: IntentConfig
): number {
  const allKeywords = [
    ...config.coreKeywords,
    ...(config.variantKeywords || []),
  ];
  
  const intentChars = new Set(allKeywords.join(''));
  const textChars = new Set(text);
  
  const intersection = Array.from(textChars).filter(c => intentChars.has(c));
  const union = new Set([...Array.from(textChars), ...Array.from(intentChars)]);
  
  if (union.size === 0) return 0;
  return intersection.length / union.size;
}

/**
 * 计算文本与单个关键词的字符级相似度
 */
export function calculateKeywordCharSimilarity(
  text: string,
  keyword: string
): number {
  const textChars = new Set(text);
  const keywordChars = new Set(keyword);
  
  const intersection = Array.from(textChars).filter(c => keywordChars.has(c));
  const union = new Set([...Array.from(textChars), ...Array.from(keywordChars)]);
  
  if (union.size === 0) return 0;
  return intersection.length / union.size;
}
