/**
 * 「技能开发」角色的增量工具集
 * @module application/skill/dev/SkillDevTools
 *
 * 技能开发 = 闲聊的超集：基础 web 工具 + 本轮命中技能的原语（沿用）
 * 之外，再挂两个开发工具：
 * - skill_list：查看本机已有的自建技能（含 id / 版本 / 完整配方，供修订）
 * - skill_write：模型只提交纯声明字段，宿主补 id/version/schemaVersion、
 *   过 parseSkillRecipe 结构校验 + 原语注册表存在性校验，然后落本地库。
 *
 * 边界：
 * - 模型只写声明，绝不生成可执行代码；
 * - primitives 只能引用宿主注册表里已有的原语名，未知原语直接拒绝并回执可选清单；
 * - 修订 = 对同一 id 再 write 一次（整份配方，不是 diff）；
 * - 保存即时生效（纯声明零代码，不需要插件那道人工启用闸门），
 *   用户可在同一会话里说一句触发词当场验收。
 *
 * id 生成：新建时由宿主按 name 确定性地生成 `user.` 前缀 id。用 FNV-1a 32bit
 * （标准具名算法：offset basis 2166136261 / prime 16777619，转 base36）做短哈希，
 * 再拼一段可读 ASCII slug；它只是稳定标识符，不是阈值 / 打分 /  tunable 数值。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { ToolExecutor, ToolOutcome } from '@application/chat/ToolLoop';
import type { SkillPrimitive } from '@application/skill/SkillTypes';
import { parseSkillRecipe } from '@application/skill/SkillRecipe';
import { NAVIGATE_TO_TOOL_NAME, NAVIGATE_TO_TOOL } from '@application/skill/primitives/BasicPrimitives';
import type { UserSkillStore } from './UserSkillStore';

export interface SkillDevDeps {
  /** 用户自建技能库（与面板 / SkillCatalogService 共用同一实例） */
  users: UserSkillStore;
  /** 宿主原语注册表（与 selectSkills / buildSkillToolParts 同一份） */
  primitives: ReadonlyMap<string, SkillPrimitive>;
}

/** 挂进闲聊工具集的增量片段 */
export interface SkillDevKit {
  tools: ModelToolDefinition[];
  executors: Record<string, ToolExecutor>;
  /** 开发说明 system 片段，追加到本轮 system 尾部 */
  systemSuffix: string;
}

const SKILL_LIST_TOOL: ModelToolDefinition = {
  name: 'skill_list',
  description:
    '列出本机已保存的所有自建技能，返回每条的 id、名称、版本、启用状态与完整配方 JSON。'
    + '修订前先用它拿到目标 id 和当前内容。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

const SKILL_WRITE_TOOL: ModelToolDefinition = {
  name: 'skill_write',
  description:
    '创建或修订一条本机自建技能配方（纯声明 JSON，不含任何代码）。保存后立即生效。'
    + '新建时不填 id（宿主生成 user. 前缀的稳定 id）；修订时填 skill_list 查到的同一 id，'
    + '并给出整份配方。primitives 只能引用系统提示里「可用原语」列出的名字。',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '可选。修订已有技能时填它的 id（user. 开头，来自 skill_list）；新建时省略。',
      },
      name: { type: 'string', description: '展示名称' },
      summary: { type: 'string', description: '一句话说明该技能做什么（给模型看）' },
      triggers: {
        type: 'array', items: { type: 'string' },
        description: '触发词/短语数组，用户消息「包含即命中」，至少 1 条',
      },
      primitives: {
        type: 'array', items: { type: 'string' },
        description: '引用的宿主原语名数组，至少 1 条，必须来自「可用原语」清单',
      },
      prompt: {
        type: 'string',
        description: '命中后追加给对话的自然语言指令（纯文本，不写代码、不写网址模板）',
      },
    },
    required: ['name', 'summary', 'triggers', 'primitives', 'prompt'],
    additionalProperties: false,
  },
};

/** FNV-1a 32bit：标准具名哈希，仅用于把 name 稳定地映射成短 id */
function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 由 name 生成 `user.` 前缀、确定性、可读的稳定 id */
export function makeUserSkillId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const hash = fnv1a(name).toString(36);
  return `user.${slug ? `${slug}-` : ''}${hash}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 把可用原语清单拼成 system 里的说明文字（name + 我们写的工具描述） */
function renderPrimitives(primitives: ReadonlyMap<string, SkillPrimitive>): string {
  const lines: string[] = [];
  for (const [name, prim] of primitives) {
    lines.push(`- ${name}：${prim.definition.description}`);
  }
  return lines.join('\n');
}

/**
 * 引用了 navigate_to 时，写配方的人（模型）必须知道「宿主注入链接」契约。
 * 文案直接派生自工具定义本身（单一出处），不在这里抄第二份、也不会漂移。
 */
function navigateAuthoringHint(primitives: ReadonlyMap<string, SkillPrimitive>): string[] {
  if (!primitives.has(NAVIGATE_TO_TOOL_NAME)) return [];
  return [
    `- 配方引用 ${NAVIGATE_TO_TOOL_NAME} 时，prompt 里也要写清这条契约（照工具定义原话）：`,
    `  ${NAVIGATE_TO_TOOL.description}`,
    '  别在 prompt 里让模型「把链接贴给用户」或给出任何网址模板；链接一律由宿主按钮呈现。',
  ];
}

/** 开发角色追加到 system 的说明片段 */
function buildSystemSuffix(primitives: ReadonlyMap<string, SkillPrimitive>): string {
  return [
    '【技能开发能力】',
    '你是「技能开发」助手：既能像闲聊一样正常对话与使用网页/技能工具，也能在本机创建/修订「技能配方」。',
    '技能是一条纯声明 JSON：命中触发词后，给对话补一段提示并挂上若干宿主已有的「原语」工具。',
    '技能不含、也绝不能写任何可执行代码；你只能组合下面这些宿主已有的原语。',
    '',
    '可用原语（primitives 只能从这里挑，填原语名）：',
    renderPrimitives(primitives),
    '',
    '用 skill_list 查看本机已有自建技能（含 id、版本、启用状态、完整配方）；用 skill_write 创建/修订。',
    'skill_write 字段：name / summary / triggers（触发词数组，至少 1 条）/ primitives（原语名数组，'
      + '至少 1 条，必须来自上表）/ prompt（命中后追加的自然语言指令，纯文本）；'
      + 'id 可选，修订时填 skill_list 查到的同一 id（user. 开头），新建时省略。',
    '',
    '硬性规则：',
    '- 只写声明 JSON，绝不生成代码；primitives 出现上表以外的名字会被宿主拒绝。',
    '- 每次提交都是整份配方（不是 diff）；修订时把全部字段重新给全。',
    '- 保存后可让用户直接说一句触发词，在同一会话里当场验收；不满意就按同一 id 再写一次修订。',
    '- 自建技能只保存在当前浏览器，可在右上角 ⋮ →「🧠 技能」里启停 / 删除 / 配置在线技能源。',
    ...navigateAuthoringHint(primitives),
  ].join('\n');
}

/** 构造挂到闲聊工具集上的增量片段（工具声明 + 执行器 + system 说明） */
export function createSkillDevKit(deps: SkillDevDeps): SkillDevKit {
  const { users, primitives } = deps;
  const validPrimitiveNames = [...primitives.keys()];

  const listExecutor: ToolExecutor = async (): Promise<ToolOutcome> => {
    try {
      const entries = await users.list();
      if (entries.length === 0) {
        return {
          observation: '当前没有任何本机自建技能。你可以用 skill_write 创建第一条。',
          ok: true, detail: '列出自建技能（空）',
        };
      }
      const lines = entries.map((e) => JSON.stringify({
        id: e.recipe.id, name: e.recipe.name, version: e.recipe.version,
        enabled: e.enabled, triggers: e.recipe.triggers,
        primitives: e.recipe.primitives, summary: e.recipe.summary,
        prompt: e.recipe.prompt,
      }));
      const observation = [
        `当前有 ${entries.length} 条本机自建技能：`,
        ...lines,
        '修订某条时把它的 id 原样填进 skill_write，并给出完整配方。',
      ].join('\n');
      return { observation, ok: true, detail: `列出 ${entries.length} 条自建技能` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { observation: `读取自建技能失败：${reason}`, ok: false, detail: '读取自建技能失败' };
    }
  };

  const writeExecutor: ToolExecutor = async (argsJson: string): Promise<ToolOutcome> => {
    let args: unknown;
    try {
      args = JSON.parse(argsJson) as unknown;
    } catch {
      return { observation: '入参不是合法 JSON，未能保存技能', ok: false, detail: '技能保存失败' };
    }
    if (!isRecord(args)) {
      return { observation: '入参必须是一个对象，未能保存技能', ok: false, detail: '技能保存失败' };
    }

    // id：修订走显式 id（必须 user. 前缀，禁止模型覆盖内置/在线技能）；新建由宿主按 name 生成
    let id: string;
    const rawId = args['id'];
    if (typeof rawId === 'string' && rawId.trim() !== '') {
      if (!rawId.startsWith('user.')) {
        return {
          observation: 'id 必须以 user. 开头（本机自建技能专用前缀），不能用它覆盖内置或在线技能。',
          ok: false, detail: '技能 id 不合法',
        };
      }
      id = rawId.trim();
    } else {
      const name = typeof args['name'] === 'string' ? args['name'] : '';
      id = makeUserSkillId(name);
    }

    // 原语存在性校验：与 selectSkills 用的是同一份注册表，保证「造时能引用」=「用时能挂上」
    const primNames = args['primitives'];
    if (Array.isArray(primNames)) {
      const unknown = (primNames as unknown[]).filter(
        (n) => typeof n !== 'string' || !primitives.has(n),
      );
      if (unknown.length > 0) {
        return {
          observation: [
            `primitives 含有宿主不认识的原语：${unknown.map(String).join('、')}。`,
            `可用原语只有：${validPrimitiveNames.join('、')}。请改用其中的名字后重新调用。`,
          ].join('\n'),
          ok: false, detail: '技能引用了未知原语',
        };
      }
    }

    // 结构校验复用唯一解析器：宿主补齐结构字段，模型不写 version / schemaVersion
    const parsed = parseSkillRecipe({
      schemaVersion: 1,
      id,
      version: 1, // 占位；UserSkillStore.save 会按同 id 现有版本 +1 覆盖，模型永远不写版本号
      name: args['name'],
      summary: args['summary'],
      triggers: args['triggers'],
      primitives: args['primitives'],
      prompt: args['prompt'],
    });
    if (!parsed.ok) {
      return {
        observation: `技能配方不合法：${parsed.reason}。请修正字段后重新调用。`,
        ok: false, detail: '技能配方校验失败',
      };
    }

    try {
      const entry = await users.save(parsed.skill);
      const observation = [
        `已保存技能「${entry.recipe.name}」（id=${entry.recipe.id}，v${entry.recipe.version}）。`,
        `触发词：${entry.recipe.triggers.join('、')}；引用原语：${entry.recipe.primitives.join('、')}。`,
        '技能已即时生效。请让用户直接说一句触发词，就可以在同一会话里验收效果；',
        '若不满意，按同一 id 再次 skill_write 给出完整配方即可修订。',
      ].join('\n');
      return { observation, ok: true, detail: `已保存技能「${entry.recipe.name}」` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { observation: `保存技能失败：${reason}`, ok: false, detail: '技能保存失败' };
    }
  };

  return {
    tools: [SKILL_LIST_TOOL, SKILL_WRITE_TOOL],
    executors: {
      [SKILL_LIST_TOOL.name]: listExecutor,
      [SKILL_WRITE_TOOL.name]: writeExecutor,
    },
    systemSuffix: buildSystemSuffix(primitives),
  };
}
