/**
 * TimeExpressionRecognizer 单元测试
 */

import { describe, it, expect } from 'vitest';
import { TimeExpressionRecognizer } from '../TimeExpressionRecognizer';

describe('TimeExpressionRecognizer', () => {
  const recognizer = new TimeExpressionRecognizer();

  describe('isPeriodic', () => {
    it('应该识别"每天"为周期性任务', () => {
      expect(recognizer.isPeriodic('每天分析对手')).toBe(true);
    });

    it('应该识别"每日"为周期性任务', () => {
      expect(recognizer.isPeriodic('每日生成实战选点题目')).toBe(true);
    });

    it('应该识别"每周"为周期性任务', () => {
      expect(recognizer.isPeriodic('每周查询棋手')).toBe(true);
    });

    it('应该识别"每月"为周期性任务', () => {
      expect(recognizer.isPeriodic('每月分析对手')).toBe(true);
    });

    it('应该识别"定时"为周期性任务', () => {
      expect(recognizer.isPeriodic('定时分析对手')).toBe(true);
    });

    it('应该识别"定期"为周期性任务', () => {
      expect(recognizer.isPeriodic('定期查询棋手')).toBe(true);
    });

    it('应该识别"工作日"为周期性任务', () => {
      expect(recognizer.isPeriodic('工作日分析对手')).toBe(true);
    });

    it('应该识别"周末"为周期性任务', () => {
      expect(recognizer.isPeriodic('周末查询棋手')).toBe(true);
    });

    it('应该识别"隔天"为周期性任务', () => {
      expect(recognizer.isPeriodic('隔天分析对手')).toBe(true);
    });

    it('应该识别"每周一"为周期性任务', () => {
      expect(recognizer.isPeriodic('每周一查询棋手')).toBe(true);
    });

    it('应该识别"每月1号"为周期性任务', () => {
      expect(recognizer.isPeriodic('每月1号分析对手')).toBe(true);
    });

    it('应该识别"每3天"为周期性任务', () => {
      expect(recognizer.isPeriodic('每3天查询棋手')).toBe(true);
    });

    it('不应该识别普通文本为周期性任务', () => {
      expect(recognizer.isPeriodic('分析对手')).toBe(false);
      expect(recognizer.isPeriodic('查询棋手马天放')).toBe(false);
      expect(recognizer.isPeriodic('下棋')).toBe(false);
    });
  });

  describe('recognize', () => {
    it('应该正确识别"每天8点分析对手"', () => {
      const result = recognizer.recognize('每天8点分析对手');
      expect(result.isPeriodic).toBe(true);
      expect(result.frequency).toBe('daily');
      expect(result.hour).toBe(8);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('应该正确识别"每周一10点查询棋手"', () => {
      const result = recognizer.recognize('每周一10点查询棋手');
      expect(result.isPeriodic).toBe(true);
      expect(result.frequency).toBe('weekly');
      expect(result.dayOfWeek).toBe(1);
      expect(result.hour).toBe(10);
    });

    it('应该正确识别"每月1号分析对手"', () => {
      const result = recognizer.recognize('每月1号分析对手');
      expect(result.isPeriodic).toBe(true);
      expect(result.frequency).toBe('monthly');
      expect(result.dayOfMonth).toBe(1);
    });

    it('应该正确识别"每日生成实战选点题目"', () => {
      const result = recognizer.recognize('每日生成实战选点题目');
      expect(result.isPeriodic).toBe(true);
      expect(result.frequency).toBe('daily');
      expect(result.rawMatch).toContain('每');
    });

    it('应该正确识别"工作日早上9点分析对手"', () => {
      const result = recognizer.recognize('工作日早上9点分析对手');
      expect(result.isPeriodic).toBe(true);
      expect(result.frequency).toBe('workday');
      expect(result.hour).toBe(9);
    });

    it('应该正确识别"周末下午2点查询棋手"', () => {
      const result = recognizer.recognize('周末下午2点查询棋手');
      expect(result.isPeriodic).toBe(true);
      expect(result.frequency).toBe('weekend');
      expect(result.hour).toBe(14);
    });

    it('应该正确处理不包含时间表达式的文本', () => {
      const result = recognizer.recognize('分析对手天启');
      expect(result.isPeriodic).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('应该正确处理带分钟的时间', () => {
      const result = recognizer.recognize('每天8点30分分析对手');
      expect(result.isPeriodic).toBe(true);
      expect(result.hour).toBe(8);
      expect(result.minute).toBe(30);
    });
  });

  describe('标准化', () => {
    it('应该正确处理"每1天"', () => {
      expect(recognizer.isPeriodic('每1天分析对手')).toBe(true);
    });

    it('应该正确处理"星期一"', () => {
      const result = recognizer.recognize('每周星期一分析对手');
      expect(result.isPeriodic).toBe(true);
      expect(result.dayOfWeek).toBe(1);
    });
  });
});
