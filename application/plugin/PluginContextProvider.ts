/**
 * 插件上下文提供者：给 system prompt 注入插件快照
 * @module application/plugin/PluginContextProvider
 *
 * snapshot() 每次请求都带，但**不含 code**（省 token）；
 * withCode(id) 只在选中某插件时按需展开完整源码。
 * 数据全部来自工件存储，与聊天会话无关。
 */

import type {
  IPluginArtifactStore,
  IPluginContextProvider,
  PluginArtifact,
  PluginContextEntry,
} from '../../domain/plugin/types';

export interface PluginContextLimits {
  maxNameLength: number;
  maxIntentLength: number;
}

export const DEFAULT_PLUGIN_CONTEXT_LIMITS: PluginContextLimits = {
  maxNameLength: 60,
  maxIntentLength: 200,
};

/** 按 Unicode 码点截断，末尾补省略号；未超长时原样返回 */
export function truncateForPrompt(text: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const chars = [...text];
  if (chars.length <= limit) {
    return text;
  }
  if (limit === 0) {
    return '';
  }
  return `${chars.slice(0, limit - 1).join('')}…`;
}

export class PluginContextProvider implements IPluginContextProvider {
  constructor(
    private readonly store: IPluginArtifactStore,
    private readonly limits: PluginContextLimits = DEFAULT_PLUGIN_CONTEXT_LIMITS,
  ) {}

  /** 精简清单：enabled 优先、updatedAt 降序，不含 code */
  async snapshot(): Promise<PluginContextEntry[]> {
    const artifacts = await this.store.list();
    return artifacts
      .slice()
      .sort(
        (a, b) =>
          Number(b.enabled) - Number(a.enabled)
          || b.updatedAt - a.updatedAt
          || a.id.localeCompare(b.id),
      )
      .map((artifact) => this.toEntry(artifact, false));
  }

  /** 带完整源码的条目；工件不存在返回 null */
  async withCode(id: string): Promise<PluginContextEntry | null> {
    const artifact = await this.store.get(id);
    if (artifact === null) {
      return null;
    }
    return this.toEntry(artifact, true);
  }

  private toEntry(artifact: PluginArtifact, includeCode: boolean): PluginContextEntry {
    const entry: PluginContextEntry = {
      id: artifact.id,
      name: truncateForPrompt(artifact.name, this.limits.maxNameLength),
      pointId: artifact.pointId,
      enabled: artifact.enabled,
      version: artifact.version,
      intent: truncateForPrompt(artifact.intent, this.limits.maxIntentLength),
    };
    // exactOptionalPropertyTypes：不能写 code: undefined，只在需要时赋值
    if (includeCode) {
      entry.code = artifact.code;
    }
    return entry;
  }
}
