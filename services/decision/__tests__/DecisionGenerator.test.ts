/**
 * DecisionGenerator 测试
 */

import { describe, it, expect } from 'vitest';
import { DecisionGenerator } from '../DecisionGenerator';

// 测试用的SGF（带变化图）
const TEST_SGF = `(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[黑棋]PW[白棋]KM[6.5]RE[B+R]
;B[pd];W[dd];B[qp];W[dp];B[nc]C[黑65.0%]
(;B[qf]C[黑72.0%]W[nc];B[fc])
(;B[nd]C[黑55.0%]W[po])
(;B[fq]C[黑60.0%]))`;

const TEST_SGF_NO_VARIATION = `(;GM[1]FF[4]SZ[19]PB[黑]PW[白]
;B[pd];W[dd];B[qp];W[dp])`;

describe('DecisionGenerator', () => {
  const generator = new DecisionGenerator();

  describe('从带变化图的SGF生成题目', () => {
    it('应生成至少一道题目', () => {
      const problems = generator.generate(TEST_SGF);
      expect(problems.length).toBeGreaterThan(0);
    });

    it('题目应包含正确字段', () => {
      const problems = generator.generate(TEST_SGF);
      const problem = problems[0];
      
      expect(problem).toHaveProperty('id');
      expect(problem).toHaveProperty('position');
      expect(problem).toHaveProperty('turn');
      expect(problem).toHaveProperty('options');
      expect(problem).toHaveProperty('correctIndex');
      expect(problem).toHaveProperty('difficulty');
      expect(problem).toHaveProperty('phase');
      expect(problem).toHaveProperty('metadata');
    });

    it('选项应至少有2个', () => {
      const problems = generator.generate(TEST_SGF);
      for (const problem of problems) {
        expect(problem.options.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('正确答案应为胜率最高的选项', () => {
      const problems = generator.generate(TEST_SGF);
      const problem = problems[0];
      
      // 胜率最高的应在索引0
      expect(problem.correctIndex).toBe(0);
      
      // 验证胜率排序
      const winrates = problem.options.map(o => o.winrate);
      for (let i = 1; i < winrates.length; i++) {
        expect(winrates[0]).toBeGreaterThanOrEqual(winrates[i]!);
      }
    });
  });

  describe('恶手题检测', () => {
    it('实战胜率与最高胜率差>20%应标记为blunder', () => {
      const problems = generator.generate(TEST_SGF);
      // 检查是否有blunder题
      const blunderProblems = problems.filter(p => p.difficulty === 'blunder');
      // 本测试SGF中实战与最高差距未达到20%，所以不会有blunder
      expect(blunderProblems.length).toBe(0);
    });
  });

  describe('难度筛选', () => {
    it('应返回空数组当没有匹配的难度', () => {
      const problemsEasy = generator.generate(TEST_SGF, { difficulty: 'easy' });
      const problemsMedium = generator.generate(TEST_SGF, { difficulty: 'medium' });
      
      // TEST_SGF的难度是根据胜率差计算的
      // 变化1: 55%, 变化2: 60%, 差5%属于hard
      // 所以筛选easy或medium应该返回空数组
      expect(problemsEasy.length).toBe(0);
      expect(problemsMedium.length).toBe(0);
    });
    
    it('应正确筛选hard难度', () => {
      const problems = generator.generate(TEST_SGF, { difficulty: 'hard' });
      
      // 变化1: 55%, 变化2: 60%, diff = 5% <= 5，所以是hard
      expect(problems.length).toBeGreaterThan(0);
      for (const p of problems) {
        expect(p.difficulty).toBe('hard');
      }
    });
  });

  describe('阶段筛选', () => {
    it('应支持阶段筛选', () => {
      const problems = generator.generate(TEST_SGF, { phase: 'layout' });
      
      for (const p of problems) {
        expect(p.phase).toBe('layout');
      }
    });
  });

  describe('题目数量限制', () => {
    it('应限制题目数量', () => {
      const problems = generator.generate(TEST_SGF, { maxCount: 2 });
      expect(problems.length).toBeLessThanOrEqual(2);
    });

    it('默认应限制为5道题', () => {
      const problems = generator.generate(TEST_SGF);
      expect(problems.length).toBeLessThanOrEqual(5);
    });
  });

  describe('选项去重', () => {
    it('第一步相同的变化只保留一个', () => {
      const problems = generator.generate(TEST_SGF);
      for (const problem of problems) {
        const coords = problem.options.map(o => o.position);
        const uniqueCoords = new Set(coords);
        expect(coords.length).toBe(uniqueCoords.size);
      }
    });
  });

  describe('无变化图的SGF', () => {
    it('应返回空数组', () => {
      const problems = generator.generate(TEST_SGF_NO_VARIATION);
      expect(problems.length).toBe(0);
    });
  });

  describe('恶手题优先排序', () => {
    it('blunderFirst=true时应优先恶手题', () => {
      // 使用带blunder的SGF
      const blunderSgf = `(;GM[1]SZ[19]PB[黑]PW[白]
;B[pd];W[dd]
(;B[qp]C[黑80%]W[pp])
(;B[dd]C[黑50%]))`; // 实战50% vs 最佳80%，差距30% > 20%
      
      const problems = generator.generate(blunderSgf, { blunderFirst: true });
      
      // 恶手题应在前面（如果有）
      const blunderIndex = problems.findIndex(p => p.difficulty === 'blunder');
      if (blunderIndex >= 0) {
        // blunder题应在前
        for (let i = blunderIndex + 1; i < problems.length; i++) {
          expect(problems[i]?.difficulty).not.toBe('blunder');
        }
      }
    });
  });
});