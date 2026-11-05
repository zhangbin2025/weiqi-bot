/**
 * 插件扩展点注册表
 * @module domain/plugin/PluginRegistry
 *
 * 照搬 infrastructure/network/core/ProviderRegistry.ts 的 Map + register/get/list
 * 范式，额外提供 resolve() 带 fallback 语义（找不到 / 未启用一律返回 undefined）。
 */

import type { PluginArtifact, ExtensionPointId } from './types';

export class PluginRegistry {
  private readonly artifacts = new Map<string, PluginArtifact>();

  register(artifact: PluginArtifact): void {
    if (this.artifacts.has(artifact.id)) {
      // 同名覆盖：修订后重新注册是正常路径，不抛错
      console.warn(`[PluginRegistry] artifact "${artifact.id}" replaced`);
    }
    this.artifacts.set(artifact.id, artifact);
  }

  unregister(id: string): void {
    this.artifacts.delete(id);
  }

  get(id: string): PluginArtifact | undefined {
    return this.artifacts.get(id);
  }

  has(id: string): boolean {
    return this.artifacts.has(id);
  }

  list(): PluginArtifact[] {
    return Array.from(this.artifacts.values());
  }

  /** 按扩展点列出已启用的工件 */
  listEnabled(pointId: ExtensionPointId): PluginArtifact[] {
    return this.list().filter((a) => a.enabled && a.pointId === pointId);
  }

  /**
   * 解析某个工件；不存在或未启用返回 undefined，调用方应回落到内置实现。
   */
  resolve(id: string | undefined): PluginArtifact | undefined {
    if (!id) return undefined;
    const artifact = this.artifacts.get(id);
    if (!artifact || !artifact.enabled) return undefined;
    return artifact;
  }

  clear(): void {
    this.artifacts.clear();
  }
}
