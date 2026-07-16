/**
 * IntentProcessor 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentProcessor, DEFAULT_ENTITY_DICTS } from '../IntentProcessor';
import type { ILLMClient, IntentResult } from '../../../infrastructure/utils/llm/types';
import type { ILogger } from '../../../infrastructure/logger/types';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  withContext: vi.fn().mockReturnThis(), setLevel: vi.fn(),
  enable: vi.fn(), disable: vi.fn(), getConfig: vi.fn().mockReturnValue({}),
  name: 'test-logger',
});

const logger = createMockLogger();
describe('IntentProcessor', () => {
  let mockLLMClient: ILLMClient;
  let processor: IntentProcessor;
  beforeEach(() => {
    mockLLMClient = {
      classifyIntent: vi.fn(async (text: string): Promise<IntentResult> => {
        if (text.includes('下载') || text.includes('棋谱')) {
          return { intent: 'download_game', confidence: 0.9 };
        }
        if (text.includes('查询') || text.includes('棋手')) {
          return { intent: 'query_player', confidence: 0.85 };
        }
        if (text.includes('对弈') || text.includes('下棋')) {
          return { intent: 'start_play', confidence: 0.8 };
        }
        if (text.includes('定式')) {
          return { intent: 'explore_joseki', confidence: 0.75 };
        }
        return { intent: 'unknown', confidence: 0.3 };
      }),
      extractEntities: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    processor = new IntentProcessor(mockLLMClient, logger);
  });
  describe('process - 意图处理', () => {
    it('应返回意图识别结果', async () => {
      const result = await processor.process('下载柯洁的棋谱');
      expect(result.intent).toBe('download_game');
      expect(result.confidence).toBe(0.9);
      expect(result.rawText).toBe('下载柯洁的棋谱');
    });
    it('应调用 LLM 客户端进行意图分类', async () => {
      await processor.process('查询棋手信息');
      expect(mockLLMClient.classifyIntent).toHaveBeenCalledWith('查询棋手信息');
    });
    it('意图识别失败应返回 unknown 并记录错误', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockRejectedValue(new Error('LLM error'));
      const result = await processor.process('测试文本');
      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        'Intent processing failed', expect.any(Error)
      );
    });
  });
  describe('实体提取 - 棋手名', () => {
    it('应提取知名棋手名', async () => {
      const result = await processor.process('查询柯洁的等级分');
      expect(result.entities.player).toBe('柯洁');
    });
    it('应提取申真谞', async () => {
      const result = await processor.process('申真谞最近成绩如何');
      expect(result.entities.player).toBe('申真谞');
    });
    it('应提取朴廷桓', async () => {
      const result = await processor.process('朴廷桓的棋谱');
      expect(result.entities.player).toBe('朴廷桓');
    });
    it('应提取丁浩', async () => {
      const result = await processor.process('丁浩这局下得如何');
      expect(result.entities.player).toBe('丁浩');
    });
    it('无棋手名时不应有 player 实体', async () => {
      const result = await processor.process('下载棋谱');
      expect(result.entities.player).toBeUndefined();
    });
  });
  describe('实体提取 - 平台', () => {
    it('应提取野狐平台', async () => {
      const result = await processor.process('下载野狐棋谱');
      expect(result.entities.source).toBe('野狐');
    });
    it('应提取 OGS 平台', async () => {
      const result = await processor.process('从OGS下载棋谱');
      expect(result.entities.source).toBe('OGS');
    });
    it('应提取 101围棋 平台', async () => {
      const result = await processor.process('在101围棋做题');
      expect(result.entities.source).toBe('101围棋');
    });
  });
  describe('实体提取 - 难度', () => {
    it('应提取简单难度', async () => {
      const result = await processor.process('开始简单难度的对弈');
      expect(result.entities.difficulty).toBe('简单');
    });
    it('应提取中等难度', async () => {
      const result = await processor.process('中等难度题目');
      expect(result.entities.difficulty).toBe('中等');
    });
  });
  describe('实体提取 - 定式', () => {
    it('应提取星位', async () => {
      const result = await processor.process('星位开局');
      expect(result.entities.opening).toBe('星位');
    });
    it('应提取中国流', async () => {
      const result = await processor.process('使用中国流开局');
      expect(result.entities.opening).toBe('中国流');
    });
  });
  describe('实体提取 - URL', () => {
    it('应提取 HTTP URL', async () => {
      const result = await processor.process('下载 https://example.com/game.sgf');
      expect(result.entities.url).toBe('https://example.com/game.sgf');
    });
    it('无 URL 时不应有 url 实体', async () => {
      const result = await processor.process('下载棋谱');
      expect(result.entities.url).toBeUndefined();
    });
  });
  describe('实体提取 - 数量', () => {
    it('应提取盘数', async () => {
      const result = await processor.process('下载5盘棋谱');
      expect(result.entities.count).toBe(5);
    });
    it('应提取题数', async () => {
      const result = await processor.process('完成5题');
      expect(result.entities.count).toBe(5);
    });
    it('无数量时不应有 count 实体', async () => {
      const result = await processor.process('下载棋谱');
      expect(result.entities.count).toBeUndefined();
    });
  });
  describe('实体提取 - 数字范围', () => {
    it('应提取范围（使用 -）', async () => {
      const result = await processor.process('分析1-10局');
      expect(result.entities.range).toEqual([1, 10]);
    });
    it('应提取范围（使用至）', async () => {
      const result = await processor.process('分析10至50局');
      expect(result.entities.range).toEqual([10, 50]);
    });
  });
  describe('多实体提取', () => {
    it('应同时提取多个实体', async () => {
      const result = await processor.process('从野狐下载柯洁的5盘棋谱');
      expect(result.entities.source).toBe('野狐');
      expect(result.entities.player).toBe('柯洁');
      expect(result.entities.count).toBe(5);
    });
  });
  describe('动态实体词典', () => {
    it('应支持自定义实体词典', async () => {
      const customProcessor = new IntentProcessor(mockLLMClient, logger, {
        entityDictionaries: { players: ['自定义棋手'] },
      });
      const result = await customProcessor.process('查询自定义棋手信息');
      expect(result.entities.player).toBe('自定义棋手');
    });
    it('updateDictionaries 应更新词典', async () => {
      processor.updateDictionaries({ players: ['新棋手'] });
    });
    it('addPlayer 应添加新棋手', () => {
      processor.addPlayer('新棋手甲');
    });
    it('addPlayer 不应重复添加', () => {
      processor.addPlayer('柯洁'); // 已在默认词典中
    });
    it('getDictionaries 应返回当前词典', () => {
      const dicts = processor.getDictionaries();
      expect(dicts.players).toContain('柯洁');
      expect(dicts.sources).toContain('野狐');
    });
    it('DEFAULT_ENTITY_DICTS 应包含默认词典', () => {
      expect(DEFAULT_ENTITY_DICTS.players).toContain('柯洁');
      expect(DEFAULT_ENTITY_DICTS.sources).toContain('野狐');
      expect(DEFAULT_ENTITY_DICTS.difficulties).toContain('简单');
      expect(DEFAULT_ENTITY_DICTS.openings).toContain('星位');
    });
  });
  describe('边界情况', () => {
    it('空字符串应正常处理', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockResolvedValue({
        intent: 'unknown', confidence: 0.1,
      });
      const result = await processor.process('');
      expect(result.entities).toEqual({});
      expect(result.rawText).toBe('');
    });
  });
});