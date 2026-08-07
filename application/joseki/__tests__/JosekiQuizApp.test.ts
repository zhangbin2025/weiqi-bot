import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JosekiQuizApp } from '../JosekiQuizApp';
import type { IJosekiQuizService, IQuizQuestion } from '../../../services/joseki/quiz/IJosekiQuizService';
import type { QuizQuestion as LoaderQuizQuestion } from '../../../services/joseki/IJosekiLoader';
import type { IActivityLogService, ActivityEntry, ActivityStats } from '../../../services/activity';
import { ThumbnailService } from '../../../services/thumbnail/ThumbnailService';
/** 创建 mock JosekiQuizService */
function createMockJosekiQuizService(): IJosekiQuizService {
  const mockQuizData: LoaderQuizQuestion[] = [
    { path: 'pd-qc-pc-qd', moves: 4, freq: 2281894, prob: 0.62, winrate: { delta: 0.0343, stddev: 0.14, samples: 825 } },
    { path: 'pd-qc-qd-pc', moves: 4, freq: 1500000, prob: 0.41, winrate: { delta: -0.012, stddev: 0.05, samples: 300 } },
    { path: 'pd-od-oe-qe', moves: 4, freq: 800000, prob: 0.22, winrate: { delta: 0.05, stddev: 0.03, samples: 50 } },
  ];
  return {
    loadQuizData: vi.fn().mockResolvedValue(mockQuizData),
    generateQuiz: vi.fn().mockImplementation(async (options?: any) => {
      const difficulty = options?.difficulty ?? 'easy';
      const seed = options?.seed ?? Math.random();
      const index = Math.floor(seed * mockQuizData.length) % mockQuizData.length;
      const q = mockQuizData[index]!;
      const path = q.path.split('-');
      return {
        id: `quiz-${difficulty}-${index}`,
        path,
        answer: [path[path.length - 1]!],
        options: difficulty === 'hard' ? undefined : ['qd', 'pc', 'qc'],
        difficulty: { easy: 2, medium: 4, hard: 6 }[difficulty] ?? 2,
        hint: `胜率变化: ${(q.winrate?.delta ?? 0) * 100}%`,
      } as IQuizQuestion;
    }),
  } as unknown as IJosekiQuizService;
}
/** 创建 mock ActivityLogService */
function createMockActivityLogService(): IActivityLogService {
  const entries: ActivityEntry[] = [];
  return {
    record: vi.fn().mockImplementation(async (type: string, title: string, data: Record<string, unknown>, tags?: string[]) => {
      const id = `act:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      entries.push({ id, type, title, data, tags, createdAt: Date.now() });
      return id;
    }),
    query: vi.fn().mockResolvedValue(entries),
    getById: vi.fn().mockImplementation(async (id: string) => entries.find(e => e.id === id) ?? null),
    stats: vi.fn().mockResolvedValue({ total: 10, today: 2, thisWeek: 5, thisMonth: 8, byType: {} } as ActivityStats),
    count: vi.fn().mockResolvedValue(5),
    clear: vi.fn(),
    initialize: vi.fn(),
  } as unknown as IActivityLogService;
}
/** 创建 mock ThumbnailService */
function createMockThumbnailService(): ThumbnailService {
  return {
    buildBoardState: vi.fn().mockReturnValue({ board: [], currentPlayer: 'black' }),
  } as unknown as ThumbnailService;
}
describe('JosekiQuizApp', () => {
  describe('构造函数', () => {
    it('应该接受可选参数', () => {
      const app = new JosekiQuizApp();
      expect(app).toBeDefined();
    });
    it('应该接受全部参数', () => {
      const quizService = createMockJosekiQuizService();
      const activityLogService = createMockActivityLogService();
      const thumbnailService = createMockThumbnailService();
      const app = new JosekiQuizApp(quizService, activityLogService, thumbnailService);
      expect(app).toBeDefined();
    });
  });
  describe('loadQuizData', () => {
    it('应该加载题库数据', async () => {
      const quizService = createMockJosekiQuizService();
      const app = new JosekiQuizApp(quizService);
      const count = await app.loadQuizData('easy');
      expect(quizService.loadQuizData).toHaveBeenCalledWith('easy');
      expect(count).toBeGreaterThan(0);
    });
    it('无效难度应默认为 easy', async () => {
      const quizService = createMockJosekiQuizService();
      const app = new JosekiQuizApp(quizService);
      await app.loadQuizData('invalid');
      expect(quizService.loadQuizData).toHaveBeenCalledWith('easy');
    });
    it('无 Service 时应该抛出错误', async () => {
      const app = new JosekiQuizApp();
      await expect(app.loadQuizData('easy')).rejects.toThrow('JosekiQuizService not available');
    });
  });
  describe('generateQuiz', () => {
    it('应该生成挑战题目', async () => {
      const quizService = createMockJosekiQuizService();
      const app = new JosekiQuizApp(quizService);
      const quiz = await app.generateQuiz();
      expect(quiz.id).toBeDefined();
      expect(quiz.path).toBeDefined();
      expect(quiz.answer).toBeDefined();
      expect(quiz.difficulty).toBeDefined();
    });
    it('应该传递选项给底层服务', async () => {
      const quizService = createMockJosekiQuizService();
      const app = new JosekiQuizApp(quizService);
      await app.generateQuiz({ difficulty: 'medium', seed: 0.5 });
      expect(quizService.generateQuiz).toHaveBeenCalledWith({
        difficulty: 'medium',
        seed: 0.5,
      });
    });
    it('无 Service 时应该抛出错误', async () => {
      const app = new JosekiQuizApp();
      await expect(app.generateQuiz()).rejects.toThrow('JosekiQuizService not available');
    });
  });
  describe('recordChallenge', () => {
    it('应该记录挑战结果', async () => {
      const activityLogService = createMockActivityLogService();
      const app = new JosekiQuizApp(undefined, activityLogService);
      const id = await app.recordChallenge({
        path: ['Q16', 'D4'],
        difficulty: 'easy',
        success: true,
        attempts: 1,
      });
      expect(id).toBeDefined();
      expect(activityLogService.record).toHaveBeenCalledWith(
        'quiz',
        '定式挑战：成功',
        expect.objectContaining({ path: ['Q16', 'D4'], success: true, attempts: 1 }),
        ['定式挑战', 'easy'],
      );
    });
    it('无 ActivityLogService 时应该返回 undefined', async () => {
      const app = new JosekiQuizApp();
      const id = await app.recordChallenge({
        path: ['Q16'],
        difficulty: 'easy',
        success: true,
        attempts: 1,
      });
      expect(id).toBeUndefined();
    });
  });
  describe('queryHistory', () => {
    it('应该查询挑战历史', async () => {
      const activityLogService = createMockActivityLogService();
      const app = new JosekiQuizApp(undefined, activityLogService);
      await app.queryHistory({ keyword: 'test', limit: 10, offset: 0 });
      expect(activityLogService.query).toHaveBeenCalledWith({
        type: 'quiz',
        keyword: 'test',
        limit: 10,
        offset: 0,
      });
    });
    it('无 ActivityLogService 时应该返回空数组', async () => {
      const app = new JosekiQuizApp();
      const result = await app.queryHistory();
      expect(result).toEqual([]);
    });
  });
  describe('getStats', () => {
    it('应该获取统计信息', async () => {
      const activityLogService = createMockActivityLogService();
      const app = new JosekiQuizApp(undefined, activityLogService);
      const stats = await app.getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('success');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('today');
    });
  });
  describe('clearHistory', () => {
    it('应该清空历史', async () => {
      const activityLogService = createMockActivityLogService();
      const app = new JosekiQuizApp(undefined, activityLogService);
      await app.clearHistory();
      expect(activityLogService.clear).toHaveBeenCalledWith('quiz');
    });
  });
  describe('buildBoardState', () => {
    it('应该构建棋盘状态', () => {
      const thumbnailService = createMockThumbnailService();
      const app = new JosekiQuizApp(undefined, undefined, thumbnailService);
      app.buildBoardState([{ coord: 'Q16', color: 'black' }]);
      expect(thumbnailService.buildBoardState).toHaveBeenCalledWith([{ coord: 'Q16', color: 'black' }]);
    });
  });
});
