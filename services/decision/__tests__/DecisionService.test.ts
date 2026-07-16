/**
 * DecisionService 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionService } from '../DecisionService';
import type { IDecisionResult } from '../../../domain/decision';

// 测试用的SGF
const TEST_SGF = `(;GM[1]FF[4]SZ[19]PB[黑棋]PW[白棋]KM[6.5]
;B[pd];W[dd];B[qp];W[dp]
(;B[nc]C[黑72%]W[pp])
(;B[nd]C[黑65%]W[po])
(;B[fq]C[黑60%]))`;

describe('DecisionService', () => {
  let service: DecisionService;

  beforeEach(() => {
    service = new DecisionService();
  });

  describe('generateFromSGF', () => {
    it('应生成题目并返回结果', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      
      expect(result).toHaveProperty('problems');
      expect(result).toHaveProperty('totalCount');
      expect(result).toHaveProperty('stats');
      expect(result.totalCount).toBe(result.problems.length);
    });

    it('应返回统计数据', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      
      expect(result.stats).toHaveProperty('layout');
      expect(result.stats).toHaveProperty('middle');
      expect(result.stats).toHaveProperty('endgame');
      expect(result.stats).toHaveProperty('easy');
      expect(result.stats).toHaveProperty('medium');
      expect(result.stats).toHaveProperty('hard');
      expect(result.stats).toHaveProperty('blunder');
    });

    it('应应用生成选项', async () => {
      const result = await service.generateFromSGF(TEST_SGF, { maxCount: 1 });
      expect(result.problems.length).toBeLessThanOrEqual(1);
    });
  });

  describe('saveResult', () => {
    it('应保存答题结果', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      if (result.problems.length === 0) return;

      const answerResult: IDecisionResult = {
        problemId: result.problems[0]!.id,
        selectedOption: 0,
        isCorrect: true,
        timestamp: new Date(),
      };

      await service.saveResult(answerResult);

      const history = await service.getHistory('test');
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]?.problemId).toBe(answerResult.problemId);
    });
  });

  describe('getHistory', () => {
    it('应返回答题历史', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      if (result.problems.length === 0) return;

      // 保存多个结果
      await service.saveResult({
        problemId: result.problems[0]!.id,
        selectedOption: 0,
        isCorrect: true,
        timestamp: new Date('2024-01-01'),
      });

      await service.saveResult({
        problemId: result.problems[0]!.id,
        selectedOption: 1,
        isCorrect: false,
        timestamp: new Date('2024-01-02'),
      });

      const history = await service.getHistory('test');
      expect(history.length).toBe(2);
    });

    it('应支持限制数量', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      if (result.problems.length === 0) return;

      // 保存多个结果
      for (let i = 0; i < 5; i++) {
        await service.saveResult({
          problemId: result.problems[0]!.id,
          selectedOption: i % 4,
          isCorrect: i === 0,
          timestamp: new Date(),
        });
      }

      const history = await service.getHistory('test', 2);
      expect(history.length).toBeLessThanOrEqual(2);
    });

    it('应按时间倒序排列', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      if (result.problems.length === 0) return;

      await service.saveResult({
        problemId: result.problems[0]!.id,
        selectedOption: 0,
        isCorrect: true,
        timestamp: new Date('2024-01-01'),
      });

      await service.saveResult({
        problemId: result.problems[0]!.id,
        selectedOption: 1,
        isCorrect: false,
        timestamp: new Date('2024-01-02'),
      });

      const history = await service.getHistory('test');
      expect(history[0]?.timestamp.getTime()).toBeGreaterThanOrEqual(
        history[1]?.timestamp.getTime() ?? 0
      );
    });
  });

  describe('getProblem', () => {
    it('应返回已生成的题目', async () => {
      const result = await service.generateFromSGF(TEST_SGF);
      if (result.problems.length === 0) return;

      const problemId = result.problems[0]!.id;
      const problem = await service.getProblem(problemId);

      expect(problem).not.toBeNull();
      expect(problem?.id).toBe(problemId);
    });

    it('应返回null对于不存在的题目', async () => {
      const problem = await service.getProblem('non-existent');
      expect(problem).toBeNull();
    });
  });

  describe('集成测试', () => {
    it('完整流程：生成 -> 获取 -> 答题 -> 查询历史', async () => {
      // 1. 生成
      const genResult = await service.generateFromSGF(TEST_SGF);
      expect(genResult.problems.length).toBeGreaterThan(0);

      const problemId = genResult.problems[0]!.id;

      // 2. 获取题目
      const problem = await service.getProblem(problemId);
      expect(problem).not.toBeNull();

      // 3. 答题
      const answer: IDecisionResult = {
        problemId,
        selectedOption: 0,
        isCorrect: true,
        timeSpent: 5000,
        timestamp: new Date(),
      };
      await service.saveResult(answer);

      // 4. 查询历史
      const history = await service.getHistory('test');
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]?.isCorrect).toBe(true);
    });
  });
});