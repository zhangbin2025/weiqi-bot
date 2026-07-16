/**
 * AIController 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIController } from '../AIController';
import { FunctionRegistry } from '../FunctionRegistry';
import { TaskOrchestrator } from '../TaskOrchestrator';
import { ProgressTracker } from '../ProgressTracker';
import type { ILLMClient, IntentResult } from '../../../infrastructure/utils/llm/types';
import type { AIFunction } from '../types';
import type { ILogger } from '../../../infrastructure/logger/types';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  withContext: vi.fn().mockReturnThis(), setLevel: vi.fn(),
  enable: vi.fn(), disable: vi.fn(), getConfig: vi.fn().mockReturnValue({}),
  name: 'test-logger',
});

const logger = createMockLogger();
describe('AIController', () => {
  let mockLLMClient: ILLMClient;
  let registry: FunctionRegistry;
  let orchestrator: TaskOrchestrator;
  let controller: AIController;
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
          return { intent: 'start_play', confidence: 0.7 };
        }
        return { intent: 'unknown', confidence: 0.3 };
      }),
      extractEntities: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    registry = new FunctionRegistry(logger);
    const testFunctions: AIFunction[] = [
      {
        name: 'download_game',
        description: '下载棋谱',
        parameters: {},
        execute: vi.fn().mockResolvedValue({ success: true }),
      },
      {
        name: 'query_player',
        description: '查询棋手信息',
        parameters: {},
        execute: vi.fn().mockResolvedValue({ name: '柯洁', rank: 9 }),
      },
      {
        name: 'start_play',
        description: '开始对弈',
        parameters: {},
        execute: vi.fn().mockResolvedValue({ success: true }),
      },
      {
        name: 'long_running_task',
        description: '长时间任务',
        parameters: {},
        execute: vi.fn().mockResolvedValue({ result: 'done' }),
        isLongRunning: true,
      },
    ];
    registry.registerAll(testFunctions);
    const progressTracker = new ProgressTracker(logger);
    orchestrator = new TaskOrchestrator({ registry, progressTracker, logger });
    controller = new AIController({
      llmClient: mockLLMClient,
      registry,
      orchestrator,
      logger,
    });
  });
  describe('chat - 对话处理', () => {
    it('高置信度意图应直接执行', async () => {
      const response = await controller.chat('下载柯洁的棋谱', 'user-1');
      expect(response.text).toContain('执行完成');
    });
    it('中等置信度应请求确认', async () => {
      const response = await controller.chat('我想对弈一局', 'user-1');
      expect(response.text).toContain('您是想');
      expect(response.confidence).toBe(0.7);
    });
    it('低置信度应返回不确定消息', async () => {
      const response = await controller.chat('你好世界', 'user-1');
      expect(response.text).toContain('不太确定');
    });
    it('未注册函数应返回不支持消息', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockResolvedValue({
        intent: 'unknown_intent', confidence: 0.6,
      });
      controller = new AIController({ llmClient: mockLLMClient, registry, orchestrator, logger });
      const response = await controller.chat('某个未知操作', 'user-1');
      expect(response.text).toContain('暂时不支持');
    });
  });
  describe('长时任务处理', () => {
    it('长时任务应返回 start_task 动作', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockResolvedValue({
        intent: 'long_running_task', confidence: 0.9,
      });
      controller = new AIController({ llmClient: mockLLMClient, registry, orchestrator, logger });
      const response = await controller.chat('执行长时间任务', 'user-1');
      expect(response.text).toContain('这可能需要几分钟');
      expect(response.action?.type).toBe('start_task');
      expect(response.action?.taskId).toBeDefined();
    });
    it('长时任务确认后也应返回 start_task 动作', async () => {
      const response = await controller.confirmAndExecute(
        { intent: 'long_running_task', confidence: 0.7, entities: {}, rawText: '测试' },
        'user-1'
      );
      expect(response.action?.type).toBe('start_task');
    });
  });
  describe('confirmAndExecute - 确认并执行', () => {
    it('用户确认后应执行意图', async () => {
      const intent = {
        intent: 'download_game', confidence: 0.6,
        entities: { url: 'https://example.com/game.sgf' }, rawText: '下载棋谱',
      };
      const response = await controller.confirmAndExecute(intent, 'user-1');
      expect(response.text).toContain('执行完成');
    });
    it('函数不存在应返回不可用消息', async () => {
      registry.unregister('download_game');
      const intent = {
        intent: 'download_game', confidence: 0.6,
        entities: {}, rawText: '下载棋谱',
      };
      const response = await controller.confirmAndExecute(intent, 'user-1');
      expect(response.text).toContain('已不可用');
    });
  });
  describe('getAvailableFunctions', () => {
    it('应返回已注册的函数名列表', () => {
      const functions = controller.getAvailableFunctions();
      expect(functions).toContain('download_game');
      expect(functions).toContain('query_player');
    });
  });
  describe('TaskOrchestrator 集成', () => {
    it('长时任务应通过 orchestrator 启动', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockResolvedValue({
        intent: 'long_running_task', confidence: 0.9,
      });
      controller = new AIController({ llmClient: mockLLMClient, registry, orchestrator, logger });
      const response = await controller.chat('执行任务', 'user-1');
      const taskId = response.action?.taskId;
      expect(taskId).toBeDefined();
      const task = orchestrator.getTask(taskId!);
      expect(task).toBeDefined();
      expect(task?.intent).toBe('long_running_task');
    });
    it('即时任务应通过 orchestrator 执行', async () => {
      await controller.chat('下载柯洁的棋谱', 'user-1');
      // TaskOrchestrator 应创建了即时任务
      const tasks = orchestrator.getUserTasks('user-1');
      expect(tasks.length).toBeGreaterThan(0);
    });
  });
  describe('置信度阈值', () => {
    it('置信度 0.5 以下应返回不确定', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockResolvedValue({
        intent: 'download_game', confidence: 0.4,
      });
      controller = new AIController({ llmClient: mockLLMClient, registry, orchestrator, logger });
      const response = await controller.chat('某个操作', 'user-1');
      expect(response.text).toContain('不太确定');
    });
    it('置信度 0.8 以上应直接执行', async () => {
      mockLLMClient.classifyIntent = vi.fn().mockResolvedValue({
        intent: 'download_game', confidence: 0.85,
      });
      controller = new AIController({ llmClient: mockLLMClient, registry, orchestrator, logger });
      const response = await controller.chat('下载操作', 'user-1');
      expect(response.text).toContain('执行完成');
    });
  });
});