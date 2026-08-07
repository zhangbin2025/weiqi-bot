/**
 * 时间表达式识别器实现
 * 
 * @module domain/time/TimeExpressionRecognizer
 */

import type { ITimeExpressionRecognizer } from './ITimeExpressionRecognizer';
import type { TimeExpressionResult, Frequency } from './types';
import { PERIODIC_REGEX_PATTERNS, PERIODIC_KEYWORDS, WEEK_DAY_MAP } from './patterns';

/**
 * 时间表达式识别器
 * 
 * 使用分层策略识别时间表达式：
 * 1. 正则表达式模式匹配
 * 2. 关键词映射
 * 3. 参数解析（小时、分钟、星期几、几号）
 */
export class TimeExpressionRecognizer implements ITimeExpressionRecognizer {
  /**
   * 识别文本中的时间表达式
   */
  recognize(text: string): TimeExpressionResult {
    const result: TimeExpressionResult = {
      isPeriodic: false,
      confidence: 0,
    };

    // 标准化文本（去掉空格、统一表达）
    const normalized = this.normalize(text);

    // 第一层：正则表达式模式匹配
    for (const pattern of PERIODIC_REGEX_PATTERNS) {
      const match = normalized.match(pattern);
      if (match) {
        result.isPeriodic = true;
        result.rawMatch = match[0];
        result.confidence = 0.8;
        
        // 解析频率
        result.frequency = this.parseFrequency(normalized);
        
        // 解析时间参数
        const timeParams = this.parseTimeParams(normalized);
        if (timeParams.hour !== undefined) result.hour = timeParams.hour;
        if (timeParams.minute !== undefined) result.minute = timeParams.minute;
        if (timeParams.dayOfWeek !== undefined) result.dayOfWeek = timeParams.dayOfWeek;
        if (timeParams.dayOfMonth !== undefined) result.dayOfMonth = timeParams.dayOfMonth;
        
        return result;
      }
    }

    // 第二层：关键词匹配
    for (const [keyword, frequency] of Object.entries(PERIODIC_KEYWORDS)) {
      if (normalized.includes(keyword)) {
        result.isPeriodic = true;
        result.rawMatch = keyword;
        result.frequency = frequency;
        result.confidence = 0.7;
        
        // 解析时间参数
        const timeParams = this.parseTimeParams(normalized);
        if (timeParams.hour !== undefined) result.hour = timeParams.hour;
        if (timeParams.minute !== undefined) result.minute = timeParams.minute;
        if (timeParams.dayOfWeek !== undefined) result.dayOfWeek = timeParams.dayOfWeek;
        if (timeParams.dayOfMonth !== undefined) result.dayOfMonth = timeParams.dayOfMonth;
        
        return result;
      }
    }

    return result;
  }

  /**
   * 判断文本是否包含周期性时间表达式
   */
  isPeriodic(text: string): boolean {
    return this.recognize(text).isPeriodic;
  }

  /**
   * 标准化文本
   * 
   * 统一不同的表达方式，便于后续处理
   */
  private normalize(text: string): string {
    return text
      .replace(/每1天/g, '每天')
      .replace(/每1周/g, '每周')
      .replace(/每1月/g, '每月')
      .replace(/星期([一二三四五六日天])/g, '周$1');
  }

  /**
   * 解析频率
   */
  private parseFrequency(text: string): Frequency {
    // 检查关键词映射
    for (const [keyword, frequency] of Object.entries(PERIODIC_KEYWORDS)) {
      if (text.includes(keyword)) {
        return frequency;
      }
    }

    // 根据正则匹配判断
    if (/每周/.test(text)) return 'weekly';
    if (/每月/.test(text)) return 'monthly';
    if (/工作日/.test(text)) return 'workday';
    if (/周末/.test(text)) return 'weekend';

    // 默认为每天
    return 'daily';
  }

  /**
   * 解析时间参数
   */
  private parseTimeParams(text: string): {
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
  } {
    const result: {
      hour?: number;
      minute?: number;
      dayOfWeek?: number;
      dayOfMonth?: number;
    } = {};

    // 解析小时
    const hourMatch = text.match(/(\d{1,2})点/);
    if (hourMatch) {
      let hour = parseInt(hourMatch[1]!);
      if (hour >= 0 && hour <= 23) {
        // 处理时间修饰词
        if (text.includes('下午') || text.includes('傍晚') || text.includes('晚上')) {
          // 下午/傍晚/晚上：如果小时 <= 12，加12
          if (hour <= 12) {
            hour += 12;
          }
        } else if (text.includes('中午')) {
          // 中午：强制为12点
          hour = 12;
        }
        // 凌晨、早上、上午：小时不变
        
        result.hour = hour;
      }
    }

    // 解析分钟
    const minuteMatch = text.match(/(\d{1,2})分/);
    if (minuteMatch) {
      const minute = parseInt(minuteMatch[1]!);
      if (minute >= 0 && minute <= 59) {
        result.minute = minute;
      }
    }

    // 解析星期几
    for (const [key, value] of Object.entries(WEEK_DAY_MAP)) {
      if (text.includes(key) && text.includes('周')) {
        result.dayOfWeek = value;
        break;
      }
    }

    // 解析几号
    const dayOfMonthMatch = text.match(/(\d{1,2})号/);
    if (dayOfMonthMatch) {
      const day = parseInt(dayOfMonthMatch[1]!);
      if (day >= 1 && day <= 31) {
        result.dayOfMonth = day;
      }
    }

    return result;
  }
}
