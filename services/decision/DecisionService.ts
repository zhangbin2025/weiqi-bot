/**
 * 决策服务实现
 * @module services/decision/DecisionService
 */

import type { IDecisionProblem, IDecisionResult } from '../../domain/decision';
import type { IDecisionService } from './IDecisionService';
import type { DecisionGenerateOptions, DecisionGenerateResult } from './types';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IDecisionConfig } from '../../infrastructure/config/schemas/DecisionConfigSchema';
import { DecisionGenerator } from './DecisionGenerator';

/**
 * 决策服务
 * @ai-example
 * const service = new DecisionService();
 * const result = await service.generateFromSGF(sgfContent, { maxCount: 5 });
 */
export class DecisionService implements IDecisionService {
  private generator: DecisionGenerator;
  private results: Map<string, IDecisionResult[]>;
  private problems: Map<string, IDecisionProblem>;
  private config: IDecisionConfig | null = null;
  private configProvider: IConfigProvider | null = null;

  constructor(configProvider?: IConfigProvider) {
    this.generator = new DecisionGenerator();
    this.results = new Map();
    this.problems = new Map();
    this.configProvider = configProvider ?? null;
  }

  /** 获取配置（延迟加载） */
  private async getConfig(): Promise<IDecisionConfig> {
    if (!this.config) {
      if (!this.configProvider) {
        this.config = {
          defaultMaxProblems: 10,
          defaultDifficulty: 'medium',
          defaultPhase: 'middle',
          blunderFirst: true,
          analyzeTimeout: 30000,
        };
      } else {
        this.config = await this.configProvider.getModuleConfig<IDecisionConfig>('decision');
      }
    }
    return this.config;
  }

  /** 从AI分析棋谱生成决策题 */
  async generateFromSGF(sgf: string, options?: DecisionGenerateOptions): Promise<DecisionGenerateResult> {
    const config = await this.getConfig();
    // maxCount 仅当上层显式传入时限制；difficulty / phase / blunderOnly 是过滤条件
    const mergedOptions: DecisionGenerateOptions = {
      maxCount: options?.maxCount,
      difficulty: options?.difficulty,
      phase: options?.phase,
      blunderFirst: options?.blunderFirst ?? config.blunderFirst,
      blunderOnly: options?.blunderOnly,
      archiveId: options?.archiveId,
      url: options?.url,
    };
    const problems = this.generator.generate(sgf, mergedOptions);

    // 缓存题目
    for (const problem of problems) {
      this.problems.set(problem.id, problem);
    }

    // 统计
    const stats = {
      layout: 0,
      middle: 0,
      endgame: 0,
      easy: 0,
      medium: 0,
      hard: 0,
      blunder: 0,
    };

    for (const problem of problems) {
      stats[problem.phase]++;
      stats[problem.difficulty]++;
    }

    return {
      problems,
      totalCount: problems.length,
      stats,
    };
  }

  /** 保存答题结果 */
  async saveResult(result: IDecisionResult): Promise<void> {
    const key = result.problemId;
    const existing = this.results.get(key) || [];
    existing.push(result);
    this.results.set(key, existing);
  }

  /** 查询答题历史 */
  async getHistory(userId: string, limit?: number): Promise<IDecisionResult[]> {
    // 按userId查找（当前简化实现，遍历所有结果）
    const all: IDecisionResult[] = [];
    for (const results of this.results.values()) {
      all.push(...results);
    }
    // 按时间倒序
    all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return limit ? all.slice(0, limit) : all;
  }

  /** 获取单道题目 */
  async getProblem(problemId: string): Promise<IDecisionProblem | null> {
    return this.problems.get(problemId) ?? null;
  }
}
