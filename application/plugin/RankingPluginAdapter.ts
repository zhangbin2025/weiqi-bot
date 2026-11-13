/**
 * 排名插件适配层
 * @module application/plugin/RankingPluginAdapter
 *
 * 插件实现与内置实现是同一条管线里的两个 impl：
 * 两者都只吃最原始的对阵表（RankingInput），自己算出全部中间量与最终显示数据，
 * 产出同一个 RankingOutput（columns + cells，cells 为数值或数值数组）。
 *
 * 这里把 QuickJS 沙箱包成一个 IRankingImplementation：
 * rank({ matches }) → 沙箱里执行 rank(input) → 得到 RankingOutput。
 * 结构校验与轮次派生由统一管线 computeRanking 负责，本适配器不代算、不预置字段。
 */

import type { IPluginRuntime, PluginSpec } from '@domain/plugin/types';
import { RANKING_SPEC } from '@domain/plugin/types';
import type {
  RankingInput, RankingOutput,
} from '@domain/ranking/types';
import type { IRankingImplementation } from '@domain/ranking/RankingPipeline';

export interface RankingPluginAdapterOptions {
  runtime: IPluginRuntime;
  spec?: PluginSpec;
}

/** 插件执行失败（诊断信息供上层决定是否回落内置） */
export class RankingPluginExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankingPluginExecutionError';
  }
}

/** 把 QuickJS 沙箱包装成统一管线里的一个排名实现 */
export class PluginRanking implements IRankingImplementation {
  constructor(
    private readonly code: string,
    private readonly runtime: IPluginRuntime,
    private readonly spec: PluginSpec = RANKING_SPEC,
  ) {}

  async rank(input: RankingInput): Promise<RankingOutput> {
    let result;
    try {
      result = await this.runtime.run(this.code, input, this.spec);
    } catch (error) {
      throw new RankingPluginExecutionError(
        `插件运行时异常：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!result.ok) {
      const detail = result.error?.message ?? result.hint ?? result.phase;
      throw new RankingPluginExecutionError(`插件执行失败 [${result.phase}]：${detail}`);
    }
    // 不在这里做结构判断：统一管线的 validateRankingOutput 会给出精确 hint，
    // 也避免插件层与 domain 层出现两份契约解释。
    return result.output as RankingOutput;
  }
}

/** 便捷工厂：给一段插件源码构造统一管线可用的 impl */
export function createPluginRanking(
  code: string,
  options: RankingPluginAdapterOptions,
): IRankingImplementation {
  return new PluginRanking(code, options.runtime, options.spec ?? RANKING_SPEC);
}
