/**
 * 在线插件平台编排（浏览 → 比对 → 安装 / 更新）
 * @module services/plugin-catalog/PluginCatalogService
 *
 * 边界：
 * - 只安装 `type: plugin` 且 `pointId === RANKING_SPEC.pointId`、
 *   `specVersion === RANKING_SPEC.version`、`entry === RANKING_SPEC.entry` 的条目；
 *   `type: tool` 只展示（宿主内置执行器，不引入远程执行器）。
 * - 安装 = PluginArtifactService.create(enabled:false) + catalogRef 记录来源，
 *   绝不自作主张启用；更新 = revise(trigger:'manual') 保留 history，不新建副本。
 * - 「同一个插件」判据 = 工件 catalogRef.registryUrl + resourceId 同时相等。
 *   「有更新」判据 = 远端 code 与本地 code 字符串不等（全量源码，无 magic number）。
 * - 校验在安装前由 PluginValidator 快筛；真正输出契约由 QuickJS 试跑 +
 *   validateRankingOutput 完成（注入 runtime，测试可换 mock）。
 * - 任何一步失败都不抛到 UI 层炸弹框：逐条降级为 unavailable / incompatible。
 */

import { PluginValidator, validatePluginOutput } from '@domain/plugin/PluginValidator';
import { RANKING_SPEC } from '@domain/plugin/types';
import type { PluginArtifact, IPluginRuntime, PluginRunResult } from '@domain/plugin/types';
import { SAMPLE_RANKING_INPUT } from '@domain/ranking/sampleInput';
import type { PluginArtifactService } from '@application/plugin/PluginArtifactService';
import { PluginCatalogClient } from './PluginCatalogClient';
import type { ParsedRegistryResource } from './PluginCatalogClient';
import { PluginCatalogSources } from './PluginCatalogSources';
import { PluginCatalogCache } from './PluginCatalogCache';
import type { StaticCatalogEntry } from './PluginCatalogCache';
import type {
  CatalogBrowseResult,
  CatalogEntry,
  CatalogFailure,
  CatalogSource,
  PluginManifest,
} from './PluginCatalogTypes';

export interface PluginCatalogServiceDeps {
  /** 客户端（可注入 fetch） */
  client?: PluginCatalogClient;
  /** 源管理（可注入 localStorage） */
  sources?: PluginCatalogSources;
  /** 离线缓存（可注入 localStorage） */
  cache?: PluginCatalogCache;
  /** 工件生命周期服务；来自 createPluginSystem().artifacts */
  artifacts: PluginArtifactService;
  /** 沙箱运行时；安装前试跑用，缺省时跳过试跑（仅静态预检） */
  runtime?: IPluginRuntime;
  /** 静态预检器，缺省新建 */
  validator?: PluginValidator;
}

export interface InstallResult {
  ok: boolean;
  /** 新装或更新后的工件 */
  artifact?: PluginArtifact;
  /** 动作：安装 / 更新 / 无需变更 */
  action: 'installed' | 'updated' | 'unchanged' | 'rejected';
  message: string;
  /** 非致命提示：如沙箱环境起不来，安装仍可继续（工件默认停用） */
  warning?: string;
}

export class PluginCatalogService {
  private readonly client: PluginCatalogClient;
  private readonly sources: PluginCatalogSources;
  private readonly cache: PluginCatalogCache;
  private readonly artifacts: PluginArtifactService;
  private readonly runtime: IPluginRuntime | undefined;
  private readonly validator: PluginValidator;

  constructor(deps: PluginCatalogServiceDeps) {
    this.client = deps.client ?? new PluginCatalogClient();
    this.sources = deps.sources ?? new PluginCatalogSources();
    this.cache = deps.cache ?? new PluginCatalogCache();
    this.artifacts = deps.artifacts;
    this.runtime = deps.runtime;
    this.validator = deps.validator ?? new PluginValidator();
  }

  /** 源管理直接透传（单源：当前源 + 替换 + 恢复默认） */
  listSources(): Promise<CatalogSource[]> { return this.sources.list(); }
  currentSource(): Promise<CatalogSource> { return this.sources.current(); }
  setSource(rawUrl: string): Promise<string> { return this.sources.setCurrent(rawUrl); }
  resetSource(): Promise<void> { return this.sources.reset(); }

  /**
   * 浏览当前源：取清单、逐条取 manifest + 源码，合并本地工件状态。
   * 单源失败：记录 failure，并回放该源上次成功的静态缓存（标 cached）。
   * 单条失败：把该条标 unavailable，绝不影响其它条目。
   */
  async browse(): Promise<CatalogBrowseResult> {
    const sources = await this.sources.list();
    let locals: PluginArtifact[] = [];
    try {
      locals = await this.artifacts.list();
    } catch {
      // 工件存储读失败时按「无本地工件」处理，列表仍可浏览
      locals = [];
    }

    const entries: CatalogEntry[] = [];
    const failures: CatalogFailure[] = [];

    for (const source of sources) {
      let parsed: Awaited<ReturnType<PluginCatalogClient['fetchRegistry']>>;
      try {
        parsed = await this.client.fetchRegistry(source.url);
      } catch (error) {
        failures.push({ registryUrl: source.url, reason: messageOf(error) });
        entries.push(...(await this.cachedEntries(source, locals)));
        continue;
      }

      const perSource: CatalogEntry[] = [];
      for (const item of parsed.resources) {
        perSource.push(await this.buildEntry(source, item, locals));
      }
      await this.cache.save(source.url, perSource);
      entries.push(...perSource);
    }

    return { entries, failures };
  }

  /**
   * 安装 / 更新一条资源。
   * 先做与主机 spec 的兼容检查 + 静态预检 + 沙箱试跑（有 runtime 时），
   * 再按 catalogRef 找本地工件：没有 → create；有且 code 不同 → revise。
   */
  async install(entry: CatalogEntry): Promise<InstallResult> {
    if (entry.kind !== 'plugin') {
      return { ok: false, action: 'rejected', message: '工具声明只展示，不安装' };
    }
    if (entry.remoteCode === undefined) {
      return { ok: false, action: 'rejected', message: '源码不可用，无法安装' };
    }
    const compatible = checkCompatibility(entry, this.validator);
    if (compatible !== undefined) {
      return { ok: false, action: 'rejected', message: compatible };
    }
    // 试跑返回的 rejected 是「代码本身不合格」，硬拒绝；
    // warning 是「沙箱环境不可用」，只提示、不拦安装（工件仍默认停用）。
    const trial = await this.tryRun(entry.remoteCode);
    if (trial.rejected !== undefined) {
      return { ok: false, action: 'rejected', message: trial.rejected };
    }

    const local = await this.findLocal(entry);
    const code = entry.remoteCode;
    if (local !== undefined) {
      if (local.code === code) {
        return { ok: true, action: 'unchanged', artifact: local, message: '已是最新，无需更新' };
      }
      const updated = await this.artifacts.revise(local.id, {
        code,
        trigger: 'manual',
        feedback: `在线插件源更新：${entry.resourceId}（${entry.registryUrl}）`,
      });
      const result: InstallResult = {
        ok: true, action: 'updated', artifact: updated,
        message: '已更新源码（保留历史版本）',
      };
      if (trial.warning !== undefined) result.warning = trial.warning;
      return result;
    }

    const created = await this.artifacts.create({
      name: entry.name,
      intent: entry.intent ?? entry.summary,
      code,
      pointId: RANKING_SPEC.pointId,
      origin: entry.origin ?? 'manual',
      spec: RANKING_SPEC,
      catalogRef: { registryUrl: entry.registryUrl, resourceId: entry.resourceId },
    });
    const installed: InstallResult = {
      ok: true,
      action: 'installed',
      artifact: created,
      message: '已安装（默认停用），请到「本地插件」标签页启用',
    };
    if (trial.warning !== undefined) installed.warning = trial.warning;
    return installed;
  }

  /** 按 catalogRef 找同一个插件；catalogRef 缺失的老工件不匹配（不猜名字） */
  private async findLocal(entry: CatalogEntry): Promise<PluginArtifact | undefined> {
    let locals: PluginArtifact[];
    try {
      locals = await this.artifacts.list();
    } catch {
      return undefined;
    }
    return locals.find((a) =>
      a.catalogRef !== undefined
      && a.catalogRef.registryUrl === entry.registryUrl
      && a.catalogRef.resourceId === entry.resourceId,
    );
  }

  /**
   * 沙箱试跑（尽力而为）：
   * - 代码本身的问题（compile / runtime / contract / 输出不合契约）→ rejected，硬拒绝安装；
   * - 沙箱环境的问题（crash / timeout / oom / 抛异常）→ warning，只提示不拦。
   *
   * 区分依据不是猜的阈值，而是宿主 FailurePhase 的既定语义：
   * crash/timeout/oom 由 QuickJsRuntime.makeFailure 在 Worker 起不来/被强制终止时产生，
   * 与被测源码无关；compile/runtime/contract 才来自源码执行。
   * 工件始终默认停用，启用时排名管线会再校验一次，这里放行不会绕过安全闸门。
   */
  private async tryRun(code: string): Promise<{ rejected?: string; warning?: string }> {
    if (this.runtime === undefined) return {};
    let result: PluginRunResult;
    try {
      result = await this.runtime.run(code, SAMPLE_RANKING_INPUT, RANKING_SPEC);
    } catch (error) {
      return { warning: `沙箱未能启动，已跳过试跑：${messageOf(error)}` };
    }
    if (!result.ok) {
      const detail = `${result.phase}：${result.error?.message ?? '未知错误'}`;
      const envFailure = result.phase === 'crash'
        || result.phase === 'timeout'
        || result.phase === 'oom';
      return envFailure
        ? { warning: `沙箱环境不可用，已跳过试跑（${detail}）` }
        : { rejected: `试跑失败（${detail}）` };
    }
    const check = validatePluginOutput(result.output, RANKING_SPEC, SAMPLE_RANKING_INPUT);
    if (!check.entryFound) {
      return { rejected: `输出不符合契约：${check.missingFields.join('、') || '未知原因'}` };
    }
    return {};
  }

  private async buildEntry(
    source: CatalogSource,
    item: ParsedRegistryResource,
    locals: PluginArtifact[],
  ): Promise<CatalogEntry> {
    const r = item.resource;
    const base: CatalogEntry = {
      registryUrl: source.url,
      official: source.official,
      resourceId: typeof r.id === 'string' ? r.id : item.manifestUrl,
      kind: r.type === 'tool' ? 'tool' : 'plugin',
      name: typeof r.name === 'string' ? r.name : (r.id ?? '未命名资源'),
      summary: typeof r.summary === 'string' ? r.summary : '',
      state: 'unavailable',
    };
    if (typeof r.pointId === 'string') base.pointId = r.pointId;
    if (typeof r.specVersion === 'number') base.specVersion = r.specVersion;

    // 工具声明镜像：只展示，不取源码、不提供安装
    if (r.type === 'tool') {
      return {
        ...base,
        state: 'tool-only',
        reason: '声明镜像：执行器由宿主内置，在线平台只展示不安装',
      };
    }
    if (r.type !== undefined && r.type !== 'plugin') {
      return { ...base, state: 'unavailable', reason: `未知资源类型：${r.type}` };
    }

    let manifest: PluginManifest;
    let codeUrl: string;
    try {
      const fetched = await this.client.fetchManifest(item);
      manifest = fetched.manifest;
      codeUrl = fetched.codeUrl;
    } catch (error) {
      return { ...base, state: 'unavailable', reason: `清单不可用：${messageOf(error)}` };
    }

    const enriched: CatalogEntry = {
      ...base,
      resourceId: manifest.id,
      name: manifest.name,
      pointId: manifest.pointId,
      specVersion: manifest.specVersion,
      intent: manifest.intent,
      origin: manifest.origin,
    };

    let code: string;
    try {
      code = await this.client.fetchCode(codeUrl);
    } catch (error) {
      return { ...enriched, state: 'unavailable', reason: `源码不可用：${messageOf(error)}` };
    }
    const withCode: CatalogEntry = { ...enriched, remoteCode: code };

    const incompatible = checkCompatibility(withCode, this.validator);
    if (incompatible !== undefined) {
      return { ...withCode, state: 'incompatible', reason: incompatible };
    }

    const local = locals.find((a) =>
      a.catalogRef !== undefined
      && a.catalogRef.registryUrl === source.url
      && a.catalogRef.resourceId === manifest.id,
    );
    if (local === undefined) return { ...withCode, state: 'new' };
    return {
      ...withCode,
      localArtifactId: local.id,
      state: local.code === code ? 'installed' : 'update',
    };
  }

  /** 源不可达：回放静态缓存，并按当前本地工件重算状态 */
  private async cachedEntries(
    source: CatalogSource,
    locals: PluginArtifact[],
  ): Promise<CatalogEntry[]> {
    const cached = await this.cache.load(source.url);
    return cached.map((s) => fromStatic(s, source, locals));
  }
}

/** 兼容 + 静态预检：返回人话原因，undefined 表示通过 */
function checkCompatibility(entry: CatalogEntry, validator: PluginValidator): string | undefined {
  if (entry.pointId !== RANKING_SPEC.pointId) {
    return `扩展点不匹配：资源声明 ${entry.pointId ?? '（缺失）'}，宿主只支持 ${RANKING_SPEC.pointId}`;
  }
  if (entry.specVersion !== RANKING_SPEC.version) {
    return `spec 版本不匹配：资源声明 ${entry.specVersion ?? '（缺失）'}，宿主为 ${RANKING_SPEC.version}`;
  }
  if (entry.remoteCode === undefined) return '缺少源码';
  if (!entryPattern(RANKING_SPEC.entry).test(entry.remoteCode)) {
    return `源码未声明入口函数 ${RANKING_SPEC.entry}`;
  }
  const result = validator.validate(entry.remoteCode, RANKING_SPEC);
  if (!result.ok) return result.reason ?? '静态预检未通过';
  return undefined;
}

function fromStatic(
  s: StaticCatalogEntry,
  source: CatalogSource,
  locals: PluginArtifact[],
): CatalogEntry {
  const entry: CatalogEntry = {
    registryUrl: s.registryUrl || source.url,
    official: source.official,
    resourceId: s.resourceId,
    kind: s.kind,
    name: s.name,
    summary: s.summary,
    state: 'unavailable',
    cached: true,
  };
  if (s.pointId !== undefined) entry.pointId = s.pointId;
  if (s.specVersion !== undefined) entry.specVersion = s.specVersion;
  if (s.remoteCode !== undefined) entry.remoteCode = s.remoteCode;
  if (s.intent !== undefined) entry.intent = s.intent;
  if (s.origin !== undefined) entry.origin = s.origin;

  if (entry.kind === 'tool') {
    return { ...entry, state: 'tool-only', reason: '声明镜像：仅展示不安装（离线缓存）' };
  }
  if (entry.remoteCode === undefined || !entryPattern(RANKING_SPEC.entry).test(entry.remoteCode)) {
    return { ...entry, state: 'unavailable', reason: '离线缓存无可用源码' };
  }
  const local = locals.find((a) =>
    a.catalogRef !== undefined
    && a.catalogRef.registryUrl === entry.registryUrl
    && a.catalogRef.resourceId === entry.resourceId,
  );
  if (local === undefined) return { ...entry, state: 'new' };
  return {
    ...entry,
    localArtifactId: local.id,
    state: local.code === entry.remoteCode ? 'installed' : 'update',
  };
}

/** 入口函数声明检查：正则由宿主 spec 的 entry 生成，不硬编码函数名 */
function entryPattern(name: string): RegExp {
  // name 来自 RANKING_SPEC.entry，本身是合法 JS 标识符（schema 已约束），无需转义
  return new RegExp(`\\b${name}\\s*\\(`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
