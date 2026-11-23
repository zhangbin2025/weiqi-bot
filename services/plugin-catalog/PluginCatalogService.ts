/**
 * 在线插件平台编排（浏览 → 比对 → 安装 / 更新）
 * @module services/plugin-catalog/PluginCatalogService
 *
 * 边界：
 * - 只安装 `type: plugin` 且 pointId 命中宿主 PLUGIN_SPECS 注册表、
 *   `specVersion === spec.version`、`entry === spec.entry` 的条目；
 *   `type: tool` 只展示（宿主内置执行器，不引入远程执行器）。
 * - 安装 = PluginArtifactService.create(enabled:false) + catalogRef 记录来源，
 *   绝不自作主张启用；更新 = revise(trigger:'manual') 保留 history，不新建副本。
 * - 「同一个插件」判据 = 工件 catalogRef.registryUrl + resourceId 同时相等。
 *   「有更新」判据 = 远端 code 与本地 code 字符串不等（全量源码，无 magic number）。
 * - 校验在安装前由 PluginValidator 快筛；真正输出契约由 QuickJS 试跑 +
 *   validatePluginOutput 完成（按 pointId 查扩展点行为注册表分派，框架不解读业务语义）。
 * - 任何一步失败都不抛到 UI 层炸弹框：逐条降级为 unavailable / incompatible。
 */

import { PluginValidator, validatePluginOutput } from '@domain/plugin/PluginValidator';
import { contractsEqual } from '@application/plugin/OperatorContract';
import type {
  ExtensionPointBehaviorRegistry,
} from '@domain/plugin/ExtensionPointBehavior';
import { resolveExtensionPointBehavior } from '@domain/plugin/ExtensionPointBehavior';
import { createExtensionPointBehaviors } from '@application/plugin/behaviors';
import { resolvePluginSpec, PLUGIN_SPECS } from '@domain/plugin/types';
import type { PluginArtifact, IPluginRuntime, PluginRunResult, PluginSpec } from '@domain/plugin/types';
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
  /** 扩展点行为注册表；由装配根注入，缺省时用默认注册表（测试便利） */
  behaviors?: ExtensionPointBehaviorRegistry;
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
  private readonly behaviors: ExtensionPointBehaviorRegistry;

  constructor(deps: PluginCatalogServiceDeps) {
    this.client = deps.client ?? new PluginCatalogClient();
    this.sources = deps.sources ?? new PluginCatalogSources();
    this.cache = deps.cache ?? new PluginCatalogCache();
    this.artifacts = deps.artifacts;
    this.runtime = deps.runtime;
    this.validator = deps.validator ?? new PluginValidator();
    this.behaviors = deps.behaviors ?? createExtensionPointBehaviors();
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
   * noStore=true（面板「手动刷新」）时整条取数链都带 cache:'no-store'，
   * 绕过浏览器/GitHub Pages 的 HTTP 缓存；离线回放缓存是另一层设计内兜底，不受影响。
   */
  async browse(noStore = false): Promise<CatalogBrowseResult> {
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
        parsed = await this.client.fetchRegistry(source.url, noStore);
      } catch (error) {
        failures.push({ registryUrl: source.url, reason: messageOf(error) });
        entries.push(...(await this.cachedEntries(source, locals)));
        continue;
      }

      const perSource: CatalogEntry[] = [];
      for (const item of parsed.resources) {
        perSource.push(await this.buildEntry(source, item, locals, noStore));
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
    const compatible = checkCompatibility(entry, this.validator, this.behaviors);
    if (compatible !== undefined) {
      return { ok: false, action: 'rejected', message: compatible };
    }
    // 试跑返回的 rejected 是「代码本身不合格」，硬拒绝；
    // warning 是「沙箱环境不可用」，只提示、不拦安装（工件仍默认停用）。
    const spec = resolvePluginSpec(entry.pointId)!; // checkCompatibility 已确认存在
    const trial = await this.tryRun(entry.remoteCode, spec, entry);
    if (trial.rejected !== undefined) {
      return { ok: false, action: 'rejected', message: trial.rejected };
    }

    const local = await this.findLocal(entry);
    const code = entry.remoteCode;
    // 分类是清单侧标注，发布方可能只改标签不改源码；安装/更新都把它同步进工件，
    // 本地面板的筛选才能跟着在线清单走。category 可能缺省（老清单）→ 清掉旧值，
    // 让 UI 按 pointId 兜底推导，避免留着过期的显式标签。
    const syncCategory = async (): Promise<void> => {
      if (local !== undefined) await this.artifacts.syncCategory(local.id, entry.category);
    };
    // workflow-operator 的算子契约（exposes[]/smoke[]）也是工件的一部分：远端只改 manifest、
    // 源码不变时仍要同步，否则宿主算子表条目会停在旧版本。新建与更新共用这一份。
    const nextContract = entry.exposes !== undefined && entry.smoke !== undefined
      ? { exposes: entry.exposes, smoke: entry.smoke }
      : undefined;
    if (local !== undefined) {
      const contractChanged = !contractsEqual(local.operatorContract, nextContract);
      await syncCategory();
      if (local.code === code && !contractChanged) {
        return { ok: true, action: 'unchanged', artifact: local, message: '已是最新，无需更新' };
      }
      if (local.code === code) {
        await this.artifacts.syncOperatorContract(local.id, nextContract);
        return {
          ok: true, action: 'updated', artifact: local,
          message: '已同步资源契约（方法白名单 / 自检样例）',
        };
      }
      const updated = await this.artifacts.revise(local.id, {
        code,
        trigger: 'manual',
        feedback: `在线插件源更新：${entry.resourceId}（${entry.registryUrl}）`,
      });
      // manifest 的 exposes[]/smoke[] 变了也要同步，否则算子契约会停在旧版本。
      // revise 只改 code/version/history，这里按新契约覆盖（没有则清空旧值）。
      await this.artifacts.syncOperatorContract(local.id, nextContract);
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
      pointId: spec.pointId,
      origin: entry.origin ?? 'manual',
      spec,
      catalogRef: { registryUrl: entry.registryUrl, resourceId: entry.resourceId },
      ...(nextContract ? { operatorContract: nextContract } : {}),
      ...(entry.category !== undefined ? { category: entry.category } : {}),
    });
    const installed: InstallResult = {
      ok: true,
      action: 'installed',
      artifact: created,
      message: '已安装（默认停用），请在「本地插件」里启用',
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
   * 工件始终默认停用，启用时宿主会再校验一次，这里放行不会绕过安全闸门。
   */
  private async tryRun(
    code: string,
    spec: PluginSpec,
    entry: CatalogEntry,
  ): Promise<{ rejected?: string; warning?: string }> {
    if (this.runtime === undefined) return {};
    const behavior = resolveExtensionPointBehavior(this.behaviors, spec.pointId);
    if (behavior === undefined) {
      return { rejected: `扩展点 ${spec.pointId} 未注册行为，无法试跑` };
    }
    // 用例构造（代表性输入 / 资源自检样例）与契约形状全部由行为提供，框架不解读。
    const contract = entry.exposes !== undefined && entry.smoke !== undefined
      ? { exposes: entry.exposes, smoke: entry.smoke }
      : undefined;
    const built = behavior.buildTrialCases({ ...(contract !== undefined ? { contract } : {}) });
    if (!built.ok) {
      return { rejected: `${behavior.label}试算输入不合法：${built.reason}` };
    }
    if (built.cases.length === 0) {
      return { rejected: `${behavior.label}缺少代表性试算用例，无法验证` };
    }
    for (const [index, c] of built.cases.entries()) {
      let result: PluginRunResult;
      try {
        result = await this.runtime.run(code, c.input, spec);
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
      const check = validatePluginOutput(result.output, behavior, c.input);
      if (!check.entryFound) {
        return { rejected: `输出不符合契约：${behavior.contractHint(check)}` };
      }
      // 「能跑但算错也拒」：期望值比对由行为提供，框架不解读业务语义。
      if (c.expect !== undefined && behavior.matchesExpect !== undefined
        && !behavior.matchesExpect(result.output, c.expect)) {
        return {
          rejected: `自检样例 ${index + 1} 结果不符：期望 ${JSON.stringify(c.expect)}，实际 ${JSON.stringify(result.output)}`,
        };
      }
    }
    return {};
  }

  private async buildEntry(
    source: CatalogSource,
    item: ParsedRegistryResource,
    locals: PluginArtifact[],
    noStore: boolean,
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
    // 分类以 registry 条目为准；manifest 里的同名字段只是冗余标注，不覆盖
    if (typeof r.category === 'string') base.category = r.category;

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
      const fetched = await this.client.fetchManifest(item, noStore);
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
    // 清单没写分类时，允许 manifest 单独补一份（兼容先给条目加标注的发布流程）
    if (enriched.category === undefined && manifest.category !== undefined) {
      enriched.category = manifest.category;
    }
    if (manifest.exposes !== undefined) enriched.exposes = manifest.exposes;
    if (manifest.smoke !== undefined) enriched.smoke = manifest.smoke;

    let code: string;
    try {
      code = await this.client.fetchCode(codeUrl, noStore);
    } catch (error) {
      return { ...enriched, state: 'unavailable', reason: `源码不可用：${messageOf(error)}` };
    }
    const withCode: CatalogEntry = { ...enriched, remoteCode: code };

    const incompatible = checkCompatibility(withCode, this.validator, this.behaviors);
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
function checkCompatibility(
  entry: CatalogEntry,
  validator: PluginValidator,
  behaviors: ExtensionPointBehaviorRegistry,
): string | undefined {
  const spec = resolvePluginSpec(entry.pointId);
  if (spec === undefined) {
    return `扩展点不匹配：资源声明 ${entry.pointId ?? '（缺失）'}，宿主注册了 ${Object.keys(PLUGIN_SPECS).join('、')}`;
  }
  if (entry.specVersion !== spec.version) {
    return `spec 版本不匹配：资源声明 ${entry.specVersion ?? '（缺失）'}，宿主 ${spec.pointId} 为 ${spec.version}`;
  }
  if (entry.remoteCode === undefined) return '缺少源码';
  if (!entryPattern(spec.entry).test(entry.remoteCode)) {
    return `源码未声明入口函数 ${spec.entry}`;
  }
  // 算子契约快筛由扩展点行为声明；这里仍需保留 workflow-operator 的 exposes[]/smoke[]
  // 原校验口径（validateOperatorContract 一行未改），通过行为间接调用。
  const behavior = resolveExtensionPointBehavior(behaviors, spec.pointId);
  if (behavior?.validateContract !== undefined) {
    const bad = behavior.validateContract({ exposes: entry.exposes, smoke: entry.smoke });
    if (bad !== undefined) return bad;
  }
  const result = validator.validate(entry.remoteCode, spec);
  if (!result.ok) return result.reason ?? '静态预检未通过';
  return undefined;
}

/** workflow-operator 算子契约快筛：方法白名单与自检样例必须齐全且形状合法 */
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
  if (s.category !== undefined) entry.category = s.category;
  if (s.remoteCode !== undefined) entry.remoteCode = s.remoteCode;
  if (s.intent !== undefined) entry.intent = s.intent;
  if (s.origin !== undefined) entry.origin = s.origin;
  if (s.exposes !== undefined) entry.exposes = s.exposes;
  if (s.smoke !== undefined) entry.smoke = s.smoke;

  if (entry.kind === 'tool') {
    return { ...entry, state: 'tool-only', reason: '声明镜像：仅展示不安装（离线缓存）' };
  }
  const cachedSpec = resolvePluginSpec(entry.pointId);
  if (entry.remoteCode === undefined || cachedSpec === undefined
      || !entryPattern(cachedSpec.entry).test(entry.remoteCode)) {
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
  // name 来自宿主 spec.entry（由 resolvePluginSpec 查表得到），本身是合法 JS
  // 标识符（资源侧 schema 已约束），无需转义
  return new RegExp(`\\b${name}\\s*\\(`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
