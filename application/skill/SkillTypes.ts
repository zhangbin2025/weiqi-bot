/**
 * 在线技能（Skill Recipe）核心类型 —— 本项目唯一类型来源。
 * @module application/skill/SkillTypes
 *
 * 设计：宿主原语内置且稳定；在线只发「纯声明 JSON 配方」，
 * 配方只引用宿主已注册的原语名，永远不含可执行代码。
 * 所有模块一律从这里 import，禁止另写一份同名类型。
 */

import type { ModelToolDefinition } from '../model/IModelGateway';
import type { SecretSpec } from './SecretSpec';

/** 宿主内置原语：真正能执行的函数。在线资源永远不含代码。 */
export interface SkillPrimitive {
  /** 与 tool name 同名，必须是宿主注册表里的固定 id */
  name: string;
  /** 传给模型的 JSON Schema */
  definition: ModelToolDefinition;
  execute(argsJson: string): Promise<PrimitiveResult>;
}

export interface PrimitiveResult {
  /** 回填给模型的观察文本（role:'tool'） */
  observation: string;
  ok: boolean;
  /** 一行人话摘要，过程块显示 */
  detail: string;
  /**
   * 只读准备动作（如 web_cache_read 读缓存分页）：与 ToolOutcome.preparatory
   * 同源，不消耗自主决策轮数。宿主内置原语才会置位；在线配方不含代码、
   * 不参与此字段的构造，因此不存在远程代码借它绕过预算的路径。
   */
  preparatory?: boolean;
  /**
   * 结构化展示链接：由宿主直接渲染/落历史，绝不写进模型回复文本。
   * 用途见 ChatUseCase / ToolLoop：规避「模型复述 URL → safeReply 转义 →
   * 历史里留下 &amp; → 下一轮照抄旧链接」的多轮退化。
   */
  actionLink?: { url: string; label: string };
}

/** 一条技能 = 纯 JSON 配方，只引用宿主原语，不含任何可执行代码 */
export interface SkillRecipe {
  schemaVersion: 1;
  /** 如 'event.import-pairing-image' */
  id: string;
  /** 正整数 */
  version: number;
  /** 展示名 */
  name: string;
  /** 一句话，给模型看 */
  summary: string;
  /** 触发词/短语，宿主按当前用户消息做「包含即命中」匹配；不引入模糊阈值 */
  triggers: string[];
  /** 引用的宿主原语名，必须全部存在于 SkillRegistry；否则该技能整条跳过 */
  primitives: string[];
  /**
   * 可选：本技能依赖的 llm-tool 能力（暴露方法名，如 ['monthCalendar']）。
   * 只有当前已启用能力库的 exposes[].name 并集包含这里**每一项**时，技能才激活 /
   * 可安装；缺一项整条跳过。写方法名而不是 libId：libId 是每次安装生成的本机
   * 指纹，跨机器不可移植。字段缺省 = 不检查，老配方行为逐字不变。
   */
  requiredCapabilities?: string[];
  /**
   * 可选：本技能声明的凭据规格（纯数据）。http_fetch_auth 按 secretKey 查这张表
   * 决定 allowedHosts / header 拼法 / 重认证状态，模型运行时无法传这些参数。
   * 缺省 = 本技能不涉及凭据，老配方逐字兼容。
   */
  secrets?: SecretSpec[];
  /** 命中后追加到 system 的自然语言指令（纯文本，无代码、无 URL 模板注入） */
  prompt: string;
}

/** 在线清单 */
export interface SkillRegistryFile {
  schemaVersion: 1;
  name: string;
  description: string;
  skills: SkillRecipe[];
}
