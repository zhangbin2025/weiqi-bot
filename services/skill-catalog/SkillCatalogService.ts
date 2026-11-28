/**
 * 技能配方编排：本地库是唯一生效来源；在线源只供浏览 / 安装
 * @module services/skill-catalog/SkillCatalogService
 *
 * 边界（安装制，与插件同套使用规则）：
 * - loadSkills() 只取本地库里 enabled 的条目，绝不联网、不叠加内置常量、不自动生效在线配方；
 * - 在线技能要经面板「安装」写进本地库，才会出现在「我的技能」并被 LLM 调用；
 * - 在线源是单源模型（默认 weiqi-assets，可改任意 https URL，见 SkillCatalogSources）；
 * - 「有更新」判据 = 远端与本地同 id 的 version 不等（沿用插件「内容不等即更新」口径，
 *   不是阈值 / 打分）；更新按同 id 覆盖、保留用户已设的启停状态；
 * - 引用了宿主注册表里没有的原语的配方只展示、不可安装；
 * - 在线取数两段式：先取瘦索引，再由索引并发取每条 skill.json；单条取不到只把该条
 *   标 unavailable（索引条目构造占位卡片），不影响其它条目；
 * - 不自建缓存、不重试、不设超时；默认沿用浏览器 fetch 缓存语义，
 *   手动刷新（noStore）才用 cache:'no-store' 绕过 HTTP 缓存；不执行任何远程代码；
 * - browse() / install() 失败都转成中文结果，绝不把异常抛到对话 / 面板炸弹框。
 * - 另含 SkillPluginInstaller：装技能时按 workflow.steps[].call 推导依赖插件，
 *   编排「自动安装 + 启用」。plan() 只读、apply() 才写，两者分离供 UI 弹框确认。
 */

import type { SkillIndexEntry, SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';
import { UserSkillStore } from '@application/skill/dev/UserSkillStore';
import { parseSkillRecipe } from '@application/skill/SkillRecipe';
import { HOST_WORKFLOW_OPERATOR_NAMESPACES } from '@application/skill/HostWorkflowNamespaces';
import { WORKFLOW_OPERATOR_POINT_ID } from '@domain/plugin/types';
import type { PluginArtifact } from '@domain/plugin/types';
import { artifactSlug } from '@application/plugin/behaviors/OperatorAdapters';
import type { PluginArtifactService } from '@application/plugin/PluginArtifactService';
import type { PluginCatalogService } from '@services/plugin-catalog/PluginCatalogService';
import type { CatalogEntry } from '@services/plugin-catalog/PluginCatalogTypes';
import { SkillCatalogClient, type ParsedSkillRegistry } from './SkillCatalogClient';
import {
  SkillCatalogSources, DEFAULT_SKILL_REGISTRY_URL, type SkillSource,
} from './SkillCatalogSources';

export interface SkillCatalogDeps {
  /** 可注入的 fetch（测试用）；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** 可注入的在线源 URL（测试用，优先级高于 sources 当前源） */
  onlineUrl?: string;
  /** 本库技能库（与面板 / 开发工具共用同一实例） */
  users?: UserSkillStore;
  /** 在线源管理（与面板共用同一实例） */
  sources?: SkillCatalogSources;
  /** 宿主原语注册表；用于「缺原语 → 不可安装」判定 */
  primitives?: ReadonlyMap<string, SkillPrimitive>;
}

/** 在线条目相对本地库的状态 */
export type SkillInstallState = 'new' | 'installed' | 'update' | 'unavailable';

/** 在线标签里的一条配方 + 它的本地状态 */
export interface SkillBrowseItem {
  recipe: SkillRecipe;
  state: SkillInstallState;
  /** unavailable 时给出原因（缺原语 / 单条配方不合法）；整份清单结构不合法由 browse 的 error 承载 */
  reason?: string;
}

/**
 * 单条配方取不到时的占位卡片：只抄索引条目的展示字段，让 UI 能渲染名称/id/版本/分类。
 * 不走 stateOf（否则二次 parse 会用「配方不合法」盖掉真实原因）；prompt 只写不可读说明，
 * 不伪造可执行指令。unavailable 条目在 ChatPage 没有安装按钮，不会传给 install。
 */
function unavailableItem(entry: SkillIndexEntry, reason: string): SkillBrowseItem {
  const recipe: SkillRecipe = {
    schemaVersion: 1,
    id: entry.id,
    version: entry.version,
    name: entry.name,
    summary: entry.summary,
    ...(entry.routeHint !== undefined ? { routeHint: entry.routeHint } : {}),
    primitives: entry.primitives,
    ...(entry.category !== undefined ? { category: entry.category } : {}),
    prompt: `该配方暂时无法读取：${reason}`,
  };
  return { recipe, state: 'unavailable', reason: `配方读取失败：${reason}` };
}

/** 「在线技能」标签的只读浏览结果 */
export interface SkillCatalogBrowseResult {
  source: SkillSource;
  /** 当前在线源里的配方及安装状态；源不可达时为空 */
  items: SkillBrowseItem[];
  /** 源不可达 / 格式不合法时的一行中文原因，供 UI 显示 */
  error?: string;
}

/** install() 的回执 */
export interface SkillInstallResult {
  ok: boolean;
  action: 'installed' | 'updated' | 'rejected';
  message: string;
}

export class SkillCatalogService {
  private readonly client: SkillCatalogClient;
  private readonly onlineUrlOverride: string | undefined;
  private readonly users: UserSkillStore;
  private readonly sources: SkillCatalogSources;
  private readonly primitives: ReadonlyMap<string, SkillPrimitive>;

  constructor(deps: SkillCatalogDeps = {}) {
    // exactOptionalPropertyTypes：可选字段条件展开，不直塞 undefined
    const clientDeps: { fetchImpl?: typeof fetch } = {};
    if (deps.fetchImpl !== undefined) clientDeps.fetchImpl = deps.fetchImpl;
    this.client = new SkillCatalogClient(clientDeps);
    this.onlineUrlOverride = deps.onlineUrl;
    this.users = deps.users ?? new UserSkillStore();
    this.sources = deps.sources ?? new SkillCatalogSources();
    this.primitives = deps.primitives ?? new Map();
  }

  /**
   * 本轮对话能用的技能：本地库里已启用的条目，仅此一层。
   * 在线源可达与否、内置常量是否存在，对对话完全无影响。
   * 本地库读取失败只当空库（不把异常抛到对话）。
   */
  async loadSkills(): Promise<SkillRecipe[]> {
    try {
      const entries = await this.users.list();
      return entries.filter((e) => e.enabled).map((e) => e.recipe);
    } catch {
      return [];
    }
  }

  /** 当前生效的在线源（面板显示 / 恢复默认按钮） */
  async currentSource(): Promise<SkillSource> {
    return this.sources.current();
  }

  /** 替换当前在线源；非法地址抛错，由 UI 转成一行提示 */
  async setSource(rawUrl: string): Promise<string> {
    return this.sources.setCurrent(rawUrl);
  }

  /** 恢复官方默认源 */
  async resetSource(): Promise<void> {
    await this.sources.reset();
  }

  /**
   * 面板「在线技能」标签：列出当前源配方 + 逐条对照本地库的安装状态。
   * noStore=true（面板「手动刷新」）时给取数请求带 cache:'no-store'，绕过浏览器/CDN
   * 的 HTTP 缓存；正常打开面板仍走默认缓存语义，不改动「不缓存/不重试」的离线语义。
   */
  async browse(noStore = false): Promise<SkillCatalogBrowseResult> {
    const source = await this.sources.current();
    const url = this.onlineUrlOverride ?? source.url;
    let parsed: ParsedSkillRegistry;
    try {
      parsed = await this.client.fetchRegistry(url, noStore);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { source, items: [], ...(reason ? { error: reason } : {}) };
    }
    const locals = await this.localEntries();
    const byId = new Map(locals.map((e) => [e.recipe.id, e]));
    // noStore 必须透传给每个 fetchSkill：否则索引新、配方旧会静默漂移。
    const items = await Promise.all(parsed.entries.map(async (item) => {
      try {
        const recipe = await this.client.fetchSkill(item, noStore);
        return this.stateOf(recipe, byId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return unavailableItem(item.entry, reason);
      }
    }));
    return { source, items };
  }

  /**
   * 安装 / 更新一条在线配方：结构校验 + 原语存在性校验 → 写本地库。
   * 与 browse() 用同一份判定，绝不绕过「缺原语不可装」。
   */
  async install(recipe: SkillRecipe): Promise<SkillInstallResult> {
    const parsed = parseSkillRecipe(recipe);
    if (!parsed.ok) {
      return { ok: false, action: 'rejected', message: `配方不合法：${parsed.reason}` };
    }
    const unknown = parsed.skill.primitives.filter((n) => !this.primitives.has(n));
    if (unknown.length > 0) {
      return {
        ok: false, action: 'rejected',
        message: `宿主没有这些原语：${unknown.join('、')}，无法安装。`,
      };
    }
    const locals = await this.localEntries();
    const existing = locals.find((e) => e.recipe.id === parsed.skill.id);
    try {
      await this.users.install(parsed.skill);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, action: 'rejected', message: reason };
    }
    return existing === undefined
      ? { ok: true, action: 'installed', message: '已安装到「我的技能」，即刻生效。' }
      : { ok: true, action: 'updated', message: '已更新（保留启停状态）。' };
  }

  /** 本库技能库（面板 / 开发工具共用同一实例） */
  userStore(): UserSkillStore {
    return this.users;
  }

  private async localEntries() {
    try {
      return await this.users.list();
    } catch {
      return [];
    }
  }

  private stateOf(
    recipe: SkillRecipe,
    byId: ReadonlyMap<string, { recipe: SkillRecipe }>,
  ): SkillBrowseItem {
    const parsed = parseSkillRecipe(recipe);
    if (!parsed.ok) {
      return { recipe, state: 'unavailable', reason: `配方不合法：${parsed.reason}` };
    }
    const unknown = parsed.skill.primitives.filter((n) => !this.primitives.has(n));
    if (unknown.length > 0) {
      return { recipe, state: 'unavailable', reason: `缺原语：${unknown.join('、')}` };
    }
    const local = byId.get(parsed.skill.id);
    if (local === undefined) return { recipe: parsed.skill, state: 'new' };
    return {
      recipe: parsed.skill,
      state: local.recipe.version === parsed.skill.version ? 'installed' : 'update',
    };
  }
}

/** 默认构造：官方默认源 + 默认本地库 */
export function createDefaultSkillCatalog(deps: SkillCatalogDeps = {}): SkillCatalogService {
  return new SkillCatalogService(deps);
}

export { DEFAULT_SKILL_REGISTRY_URL };

// ---------- 技能依赖插件：自动安装 / 启用编排（2026-11-25） ----------

const PLUGIN_RESOURCE_PREFIX = `${WORKFLOW_OPERATOR_POINT_ID}.`;

/**
 * 从配方递归推导它依赖的插件资源 id（去重、保 workflow 声明顺序，包含循环体）。散文配方返回 []。
 *
 * 口径与发布侧 collectWorkflowDependencyNamespaces()（application/skill/primitives/AuthFetchPrimitives.ts）
 * 共用 application/skill/HostWorkflowNamespaces.ts 的宿主命名空间集合：
 * 插件算子 call 形如 `<slug>.<method>`，内置算子是 snake_case、不含点（见 SkillTypes.WorkflowStep.call
 * 与 weiqi-assets/schema/workflow.schema.json）；取第一个点前的 slug，发布时映射成
 * `${WORKFLOW_OPERATOR_POINT_ID}.${slug}` 资源 id（同文件 buildPluginFiles 的 resourceId，
 * registry.json 的 id 正是此形）。不新增配方字段、零数据迁移、不设白名单：依赖由技能 Workflow 中出现的插件算子命名空间自动推导，嵌套循环体与条件分支同样纳入；已安装依赖按资源 id 去重。
 */
export function skillPluginResourceIds(recipe: SkillRecipe): string[] {
  const slugs = new Set<string>();
  const collect = (steps: readonly NonNullable<SkillRecipe['workflow']>['steps'][number][]): void => {
    for (const step of steps) {
      if (step.call !== undefined) {
        const dot = step.call.indexOf('.');
        if (dot > 0) {
          const namespace = step.call.slice(0, dot);
          // 宿主原生命名空间见共享集合，绝不作为可安装插件依赖推导出来。
          if (!HOST_WORKFLOW_OPERATOR_NAMESPACES.has(namespace)) slugs.add(namespace);
        }
      }
      if (step.forEach !== undefined) collect(step.forEach.steps);
      if (step.repeat !== undefined) collect(step.repeat.steps);
      if (step.ifElse !== undefined) {
        collect(step.ifElse.then);
        collect(step.ifElse.else ?? []);
      }
    }
  };
  collect(recipe.workflow?.steps ?? []);
  return [...slugs].map((slug) => `${PLUGIN_RESOURCE_PREFIX}${slug}`);
}

/** 本次会自动执行的一条插件动作（供确认弹框展示） */
export interface SkillPluginAction {
  /** 形如 workflow-operator.circle */
  resourceId: string;
  /** 算子命名空间（resourceId 去掉扩展点前缀） */
  slug: string;
  /** 展示名：在线条目名 / 本地工件名 */
  name: string;
  /** install = 在线安装并启用；update = 在线更新并启用；enable = 本地已有但停用，仅启用 */
  kind: 'install' | 'update' | 'enable';
  /** enable 动作对应的本地工件 id（install/update 由安装回执补） */
  artifactId?: string;
}

export interface SkillPluginPlan {
  /** 配方声明的全部依赖（含已满足的），供展示 / 诊断 */
  resourceIds: string[];
  /** 本次真正会执行的动作；空数组 = 无需弹框、可直接装技能 */
  actions: SkillPluginAction[];
  /** 无法自动满足的依赖 / 环境原因；非空时 UI 应拒绝装技能 */
  blockers: string[];
  /** @internal apply() 复用的在线条目（resourceId → 条目），UI 不消费 */
  installEntries: ReadonlyMap<string, CatalogEntry>;
}

export interface SkillPluginApplyResult {
  ok: boolean;
  message: string;
  /** 本次新装 / 更新成功的插件名 */
  installed: string[];
  /** 本次启用成功的插件名 */
  enabled: string[];
  /** 逐条中文失败原因 */
  failures: string[];
}

export interface SkillPluginInstallerDeps {
  /** 在线插件目录（插件系统装配失败时缺省 → 有依赖就给 blocker） */
  catalog?: PluginCatalogService;
  /** 本地工件服务（与在线插件面板共用同一实例） */
  artifacts?: PluginArtifactService;
}

/**
 * 编排边界：
 * - plan() 只读推导 + 状态比对；写动作（安装 + 启用）只在 apply()，且必须经 UI 弹框确认；
 * - 已启用的依赖不产生动作（进而不弹框）；停用件只启用、不重装；缺件才从在线源安装；
 * - 在线源找不到 / 插件系统未就绪 → blockers，由 UI 如实拒绝装技能，
 *   绝不静默装一条跑不起来的残废配方；
 * - 「自动启用」是用户在确认框里明确授权的动作：复用既有 PluginCatalogService.install
 *   （QuickJS 试跑 + 默认停用）后再 setEnabled(true)，不绕过任何安全闸门；
 * - 本地工件是否提供该 slug，复用 OperatorAdapters.artifactSlug 的权威口径
 *   （slug 优先，其次 catalogRef.resourceId 去前缀），自建算子插件也算已满足，不被强装在线版；
 * - 所有失败都转成中文回执，绝不把异常抛到面板。零阈值 / 零超时 / 零经验常数。
 */
export class SkillPluginInstaller {
  private readonly catalog: PluginCatalogService | undefined;
  private readonly artifacts: PluginArtifactService | undefined;

  constructor(deps: SkillPluginInstallerDeps = {}) {
    this.catalog = deps.catalog;
    this.artifacts = deps.artifacts;
  }

  /**
   * 只读推导：依赖哪些插件、其中哪些需要安装 / 更新 / 启用、哪些无法自动满足。
   *
   * 在线源只浏览一次，触发条件二选一（都不满足则零网络请求、零弹框）：
   * 1. 有缺件要从在线源装；
   * 2. 有「在线安装来的、已启用」的依赖要核对是否落后于远端（catalogRef 存在）。
   * 自建算子插件（有 slug、无 catalogRef）不参与远端更新核对：本地那份就是事实源，
   * 不能被在线同名资源覆盖。远端 state=installed 表示当前版本，零动作。
   */
  async plan(recipe: SkillRecipe): Promise<SkillPluginPlan> {
    const resourceIds = skillPluginResourceIds(recipe);
    const installEntries = new Map<string, CatalogEntry>();
    const empty = (): SkillPluginPlan => ({ resourceIds, actions: [], blockers: [], installEntries });
    if (resourceIds.length === 0) return empty();

    const catalog = this.catalog;
    const artifacts = this.artifacts;
    if (catalog === undefined || artifacts === undefined) {
      return {
        resourceIds, actions: [], installEntries,
        blockers: [`插件系统未就绪，无法自动安装依赖插件：${resourceIds.join('、')}`],
      };
    }

    let locals: PluginArtifact[] = [];
    try {
      locals = await artifacts.list();
    } catch {
      locals = []; // 工件库读失败按空集处理，下面会走在线安装 / 如实报错
    }

    const blockers: string[] = [];
    const needInstall: string[] = [];
    /** 在线安装来的、已启用的依赖：要核对远端是否落后于本地（可能需更新） */
    const needUpdateCheck: string[] = [];
    // 先按依赖收集每张卡片的动作，最后统一按 resourceIds（配方 workflow 出现顺序）输出：
    // 弹框里的清单顺序与技能 DAG 一致，别让「本地启用 / 在线安装 / 远端更新」几类把顺序搅乱。
    const byResource = new Map<string, SkillPluginAction>();

    for (const resourceId of resourceIds) {
      const slug = resourceId.slice(PLUGIN_RESOURCE_PREFIX.length);
      const local = locals.find((a) => a.pointId === WORKFLOW_OPERATOR_POINT_ID && artifactSlug(a) === slug);
      if (local === undefined) {
        needInstall.push(resourceId);
        continue;
      }
      if (!local.enabled) {
        byResource.set(resourceId, {
          resourceId, slug, name: local.name, kind: 'enable', artifactId: local.id,
        });
        continue;
      }
      // 已启用且是从在线插件源安装的：远端可能有新版本，核对后决定是否「更新并启用」。
      // 自建算子插件（无 catalogRef）不入队：不被在线同名资源覆盖。
      if (local.catalogRef !== undefined) needUpdateCheck.push(resourceId);
    }

    if (needInstall.length > 0 || needUpdateCheck.length > 0) {
      let entries: readonly CatalogEntry[] = [];
      try {
        entries = (await catalog.browseResources([...needInstall, ...needUpdateCheck])).entries;
      } catch (error) {
        blockers.push(`读取在线插件源失败：${messageOf(error)}`);
      }
      if (blockers.length === 0) {
        for (const resourceId of needInstall) {
          const slug = resourceId.slice(PLUGIN_RESOURCE_PREFIX.length);
          const entry = entries.find((e) => e.resourceId === resourceId && e.kind === 'plugin');
          if (entry === undefined) {
            blockers.push(`在线插件源里找不到依赖插件 ${resourceId}，无法自动安装`);
            continue;
          }
          // installed 也放行：install() 会返回 unchanged + 本地工件，随后照样确保启用。
          const installable = entry.state === 'new' || entry.state === 'update' || entry.state === 'installed';
          if (!installable || entry.remoteCode === undefined) {
            blockers.push(`依赖插件 ${resourceId} 当前不可安装：${entry.reason ?? entry.state}`);
            continue;
          }
          installEntries.set(resourceId, entry);
          byResource.set(resourceId, {
            resourceId, slug, name: entry.name,
            kind: entry.state === 'update' ? 'update' : 'install',
          });
        }
        for (const resourceId of needUpdateCheck) {
          const slug = resourceId.slice(PLUGIN_RESOURCE_PREFIX.length);
          const entry = entries.find((e) => e.resourceId === resourceId && e.kind === 'plugin');
          // state:update = 远端源码与本地不同（PluginCatalogService 的既有判据）；
          // installed = 当前版本；其余（含源里找不到）一律不动，不把「读不到」伪装成可更新。
          if (entry === undefined || entry.state !== 'update' || entry.remoteCode === undefined) continue;
          installEntries.set(resourceId, entry);
          byResource.set(resourceId, {
            resourceId, slug, name: entry.name, kind: 'update',
          });
        }
      }
    }

    const actions = resourceIds
      .map((id) => byResource.get(id))
      .filter((a): a is SkillPluginAction => a !== undefined);
    return { resourceIds, actions, blockers, installEntries };
  }

  /**
   * 执行确认过的 plan：逐条安装 + 启用。任一条失败都如实汇总（不抛），
   * 由 UI 决定是否放弃装技能；「部分成功」也会在 message 里如实写清。
   */
  async apply(plan: SkillPluginPlan): Promise<SkillPluginApplyResult> {
    const catalog = this.catalog;
    const artifacts = this.artifacts;
    const none: SkillPluginApplyResult = {
      ok: false, message: '', installed: [], enabled: [], failures: [],
    };
    if (catalog === undefined || artifacts === undefined) {
      return { ...none, message: '插件系统未就绪，未安装任何依赖插件。', failures: ['插件系统未就绪'] };
    }
    if (plan.blockers.length > 0) {
      const reason = `存在无法自动满足的依赖：${plan.blockers.join('；')}`;
      return { ...none, message: `${reason}。`, failures: [...plan.blockers] };
    }

    const installed: string[] = [];
    const enabled: string[] = [];
    const failures: string[] = [];
    for (const action of plan.actions) {
      try {
        let artifactId: string | undefined;
        if (action.kind !== 'enable') {
          const entry = plan.installEntries.get(action.resourceId);
          if (entry === undefined) {
            failures.push(`${action.name}：缺少在线插件条目`);
            continue;
          }
          const out = await catalog.install(entry);
          if (!out.ok) {
            failures.push(`${action.name}：${out.message}`);
            continue;
          }
          if (out.action === 'installed' || out.action === 'updated') installed.push(action.name);
          artifactId = out.artifact?.id ?? await this.findLocalId(artifacts, action.resourceId);
        } else {
          artifactId = action.artifactId ?? await this.findLocalId(artifacts, action.resourceId);
        }
        if (artifactId === undefined) {
          failures.push(`${action.name}：找不到本地工件，无法启用`);
          continue;
        }
        await artifacts.setEnabled(artifactId, true);
        enabled.push(action.name);
      } catch (error) {
        failures.push(`${action.name}：${messageOf(error)}`);
      }
    }

    const parts: string[] = [];
    if (installed.length > 0) parts.push(`已安装/更新 ${installed.join('、')}`);
    if (enabled.length > 0) parts.push(`已启用 ${enabled.join('、')}`);
    if (failures.length > 0) parts.push(`失败：${failures.join('；')}`);
    const message = parts.length > 0
      ? `依赖插件处理：${parts.join('；')}。`
      : '依赖插件均已满足，无需处理。';
    return { ok: failures.length === 0, message, installed, enabled, failures };
  }

  /** 安装回执没带工件时，按同一 slug 口径回查本地工件 id */
  private async findLocalId(
    artifacts: PluginArtifactService,
    resourceId: string,
  ): Promise<string | undefined> {
    const slug = resourceId.slice(PLUGIN_RESOURCE_PREFIX.length);
    try {
      const locals = await artifacts.list();
      return locals.find((a) => a.pointId === WORKFLOW_OPERATOR_POINT_ID && artifactSlug(a) === slug)?.id;
    } catch {
      return undefined;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
