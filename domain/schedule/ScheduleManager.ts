/**
 * 调度频率类型
 */
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * 调度配置
 */
export interface ScheduleConfig {
  id: string;
  type: string;                    // 任务类型：'analyze_opponent', 'query_player', 等
  params: Record<string, any>;     // 任务参数
  frequency: ScheduleFrequency;    // 频率：每天、每周、每月
  hour: number;                    // 小时（0-23）
  minute: number;                  // 分钟（0-59）
  dayOfWeek?: number | undefined;        // 周几（1-7，每周时使用，1=周一，7=周日）
  dayOfMonth?: number | undefined;       // 几号（1-31，每月时使用）
  enabled: boolean;                // 是否启用
  lastRunDate: string | null;      // 最后执行日期（YYYY-MM-DD）
  lastRunTime: number | null;      // 最后执行时间戳
  pageUrl?: string | undefined;       // 业务页面 URL（用于 App 定时任务）
  lastResult?: {                   // 最后一次执行结果
    status: 'completed' | 'failed';
    title?: string;
    message?: string;
    completedAt: number;           // 完成时间戳
  };
}

/**
 * 时间解析结果
 */
export interface ParsedTime {
  frequency: ScheduleFrequency;
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

/**
 * 调度管理器 - 领域层
 * 
 * 职责：
 * - 解析用户输入的时间表达式
 * - 判断是否需要执行任务
 * - 提供统一的调度逻辑
 */
export class ScheduleManager {
  /**
   * 从用户输入中解析时间和频率
   * 
   * 支持的格式：
   * - "每天12点分析对手天启" → daily, 12:00
   * - "每周一8点分析对手天启" → weekly, 8:00, dayOfWeek=1
   * - "每月1号10点分析对手天启" → monthly, 10:00, dayOfMonth=1
   * - "每天分析对手天启"（没说时间）→ daily, 当前时间
   * - "分析对手天启"（没说频率）→ 立即执行一次
   */
  static parseTimeExpression(text: string): ParsedTime {
    const result: ParsedTime = {
      frequency: 'daily',
      hour: new Date().getHours(),
      minute: 0,
    };

    // 解析频率
    if (text.includes('每周') || text.includes('每星期')) {
      result.frequency = 'weekly';
      
      // 解析周几
      const weekDayMap: Record<string, number> = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
        '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 7, '周天': 7,
        '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5, '星期六': 6, '星期日': 7, '星期天': 7,
      };
      
      for (const [key, value] of Object.entries(weekDayMap)) {
        if (text.includes(key)) {
          result.dayOfWeek = value;
          break;
        }
      }
    } else if (text.includes('每月')) {
      result.frequency = 'monthly';
      
      // 解析几号
      const dayOfMonthMatch = text.match(/(\d+)号/);
      if (dayOfMonthMatch) {
        result.dayOfMonth = parseInt(dayOfMonthMatch[1]!);
      }
    } else if (text.includes('每天') || text.includes('每日')) {
      result.frequency = 'daily';
    }

    // 解析时间
    const hourMatch = text.match(/(\d+)点/);
    if (hourMatch) {
      result.hour = parseInt(hourMatch[1]!);
    }

    return result;
  }

  /**
   * 判断是否需要执行任务
   * 
   * 5 步判断：
   * 1. 禁用 → 不执行
   * 2. 时间窗口（hour ±1）不匹配 → 不执行
   * 3. 从未执行过 → 执行
   * 4. 上次失败 → 1 小时后重试
   * 5. 上次成功 → 检查是否跨周期
   * 
   * @param config 调度配置
   * @param now 当前时间（可选，默认为当前时间）
   * @returns 是否需要执行
   */
  static shouldExecute(config: ScheduleConfig, now: Date = new Date()): boolean {
    const id = config.id;

    // 1. 禁用则不执行
    if (!config.enabled) {
      console.log(`[shouldExecute] ${id} → NO (disabled)`);
      return false;
    }

    // 2. 检查时间是否匹配（允许 ±1 小时误差）
    const currentHour = now.getHours();
    const hourDiff = Math.abs(currentHour - config.hour);
    if (hourDiff > 1) {
      console.log(`[shouldExecute] ${id} → NO (hour mismatch: current=${currentHour}, target=${config.hour}, diff=${hourDiff})`);
      return false;
    }

    // 3. 从未执行过 → 执行
    if (!config.lastRunTime) {
      console.log(`[shouldExecute] ${id} → YES (never executed, hour=${currentHour} matches target=${config.hour})`);
      return true;
    }

    // 4. 上次失败 → 执行（允许重试，但限制 1 小时内只重试一次）
    if (config.lastResult?.status === 'failed') {
      const lastRun = new Date(config.lastRunTime);
      const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (60 * 60 * 1000);
      if (hoursSinceLastRun >= 1) {
        console.log(`[shouldExecute] ${id} → YES (retry after failure, ${hoursSinceLastRun.toFixed(1)}h since last run)`);
        return true;
      } else {
        console.log(`[shouldExecute] ${id} → NO (failed but retried ${hoursSinceLastRun.toFixed(1)}h ago, wait 1h)`);
        return false;
      }
    }

    // 5. 上次成功 → 检查是否跨周期
    const lastRun = new Date(config.lastRunTime);

    switch (config.frequency) {
      case 'daily': {
        const sameDay = lastRun.toDateString() === now.toDateString();
        if (sameDay) {
          console.log(`[shouldExecute] ${id} → NO (daily: already executed today, lastRun=${lastRun.toISOString()})`);
          return false;
        }
        console.log(`[shouldExecute] ${id} → YES (daily: new day, lastRun=${lastRun.toDateString()}, today=${now.toDateString()})`);
        return true;
      }

      case 'weekly': {
        // 检查星期几
        if (config.dayOfWeek !== undefined) {
          const dayOfWeek = now.getDay(); // 0=周日
          const normalizedDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek; // 1-7
          if (normalizedDayOfWeek !== config.dayOfWeek) {
            console.log(`[shouldExecute] ${id} → NO (weekly: today is day ${normalizedDayOfWeek}, target is day ${config.dayOfWeek})`);
            return false;
          }
        }
        // 检查是否跨周
        const sameWeek = this.getWeekNumber(lastRun) === this.getWeekNumber(now);
        if (sameWeek) {
          console.log(`[shouldExecute] ${id} → NO (weekly: already executed this week, lastRun=${lastRun.toISOString()})`);
          return false;
        }
        console.log(`[shouldExecute] ${id} → YES (weekly: new week, on target day)`);
        return true;
      }

      case 'monthly': {
        // 检查日期
        if (config.dayOfMonth !== undefined) {
          if (now.getDate() !== config.dayOfMonth) {
            console.log(`[shouldExecute] ${id} → NO (monthly: today is day ${now.getDate()}, target is day ${config.dayOfMonth})`);
            return false;
          }
        }
        // 检查是否跨月
        const sameMonth = lastRun.getMonth() === now.getMonth() && lastRun.getFullYear() === now.getFullYear();
        if (sameMonth) {
          console.log(`[shouldExecute] ${id} → NO (monthly: already executed this month, lastRun=${lastRun.toISOString()})`);
          return false;
        }
        console.log(`[shouldExecute] ${id} → YES (monthly: new month, on target day)`);
        return true;
      }

      default:
        console.log(`[shouldExecute] ${id} → NO (unknown frequency: ${config.frequency})`);
        return false;
    }
  }

  /**
   * 获取 ISO 周数
   * 
   * @param date 日期
   * @returns 周数（1-53）
   */
  private static getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  /**
   * 创建调度配置
   */
  static createConfig(
    type: string,
    params: Record<string, any>,
    timeExpression: string
  ): ScheduleConfig {
    const parsed = this.parseTimeExpression(timeExpression);
    
    return {
      id: `schedule_${Date.now()}`,
      type,
      params,
      frequency: parsed.frequency,
      hour: parsed.hour,
      minute: parsed.minute,
      dayOfWeek: parsed.dayOfWeek,
      dayOfMonth: parsed.dayOfMonth,
      enabled: true,
      lastRunDate: null,
      lastRunTime: null,
    };
  }

  /**
   * 标记任务为已执行
   */
  static markAsExecuted(
    config: ScheduleConfig,
    result?: { status: 'completed' | 'failed'; title?: string; message?: string }
  ): ScheduleConfig {
    const now = new Date();
    return {
      id: config.id,
      type: config.type,
      params: config.params,
      frequency: config.frequency,
      hour: config.hour,
      minute: config.minute,
      dayOfWeek: config.dayOfWeek,
      dayOfMonth: config.dayOfMonth,
      enabled: config.enabled,
      lastRunDate: now.toISOString().split('T')[0],
      lastRunTime: now.getTime(),
      pageUrl: config.pageUrl,
      lastResult: result ? {
        status: result.status,
        title: result.title,
        message: result.message,
        completedAt: now.getTime(),
      } : config.lastResult,
    } as ScheduleConfig;
  }

  /**
   * 获取频率的中文描述
   */
  static getFrequencyDescription(config: ScheduleConfig): string {
    switch (config.frequency) {
      case 'daily':
        return '每天';
      case 'weekly':
        const weekDays = ['一', '二', '三', '四', '五', '六', '日'];
        return `每周${weekDays[(config.dayOfWeek || 1) - 1]}`;
      case 'monthly':
        return `每月${config.dayOfMonth}号`;
      default:
        return '未知';
    }
  }

  /**
   * 获取执行时间的描述
   */
  static getTimeDescription(config: ScheduleConfig): string {
    const hour = String(config.hour).padStart(2, '0');
    const minute = String(config.minute).padStart(2, '0');
    const frequency = this.getFrequencyDescription(config);
    return `${frequency} ${hour}:${minute}`;
  }
}
