/**
 * 时间表达式识别器接口
 * 
 * @module domain/time/ITimeExpressionRecognizer
 */

import type { TimeExpressionResult } from './types';

/**
 * 时间表达式识别器接口
 * 
 * 职责：
 * - 识别文本中的周期性时间表达式
 * - 解析时间参数（小时、分钟、星期几、几号等）
 * - 判断是否为周期性任务
 */
export interface ITimeExpressionRecognizer {
  /**
   * 识别文本中的时间表达式
   * 
   * @param text 用户输入文本
   * @returns 识别结果
   * 
   * @example
   * const result = recognizer.recognize('每天8点分析对手');
   * // { isPeriodic: true, frequency: 'daily', hour: 8, confidence: 0.9 }
   * 
   * @example
   * const result = recognizer.recognize('每周一10点查询棋手');
   * // { isPeriodic: true, frequency: 'weekly', dayOfWeek: 1, hour: 10, confidence: 0.95 }
   */
  recognize(text: string): TimeExpressionResult;
  
  /**
   * 判断文本是否包含周期性时间表达式
   * 
   * @param text 用户输入文本
   * @returns 是否为周期性任务
   * 
   * @example
   * recognizer.isPeriodic('每天分析对手') // true
   * recognizer.isPeriodic('分析对手') // false
   */
  isPeriodic(text: string): boolean;
}
