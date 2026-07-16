/**
 * 时间表达式识别结果
 */
export interface TimeExpressionResult {
  isPeriodic: boolean;              // 是否为周期性任务
  frequency?: 'daily' | 'weekly' | 'monthly' | 'workday' | 'weekend';
  hour?: number;                    // 小时 (0-23)
  minute?: number;                  // 分钟 (0-59)
  dayOfWeek?: number;               // 周几 (1-7, 1=周一, 7=周日)
  dayOfMonth?: number;              // 几号 (1-31)
  rawMatch?: string;                // 匹配到的原始文本
  confidence: number;               // 置信度 (0-1)
}

/**
 * 周期频率类型
 */
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'workday' | 'weekend';
