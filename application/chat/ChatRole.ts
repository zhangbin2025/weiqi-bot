/**
 * 对话页的「模型角色」定义
 * @module application/chat/ChatRole
 *
 * 用户显式选角色：角色确定后才挂对应的工具集与 system prompt。
 * - chat（默认）：挂网页/PDF/图片工具与命中技能的原语，纯对话，不接触插件/技能开发。
 * - dev「开发」：chat 超集 + 插件工具集 + 技能开发工具集。既能写插件算子，
 *   也能写技能配方（含引用算子的 workflow），并在同一会话里当场验收。
 *
 * 2026-11-24 合并：原 plugin（插件开发）与 skill-dev（技能开发）两个角色合并为
 * 「开发」——技能要引用插件算子，两条开发链本就该在同一会话里完成。历史会话里
 * 持久化的旧 id 由 parseRoleId 统一映射到 dev，不新增第三套对话角色。
 *
 * 扩展性：新增角色只需在 CHAT_ROLES 里加一项（id / 展示 / 能力开关）。
 */

/** 角色 id。字符串枚举便于持久化到 localStorage / 会话元数据。 */
export type ChatRoleId = 'chat' | 'dev';

export interface ChatRoleConfig {
  id: ChatRoleId;
  /** 选择器里显示的名字 */
  label: string;
  /** 选择器里的简短说明 */
  description: string;
  /** 标题栏/输入框上的提示图标 */
  icon: string;
  /** 输入框 placeholder */
  placeholder: string;
  /** 是否挂插件工具集（标准 tool-calling 的 tools + 动态 system） */
  agent: boolean;
  /** 是否挂技能开发工具集（skill_list / skill_write + 开发说明） */
  skillDev: boolean;
  /** 是否展示过程日志（各角色都按「真的执行过工具」懒建） */
  trace: boolean;
}

/**
 * 角色表 —— 唯一的扩展点。
 * 顺序即选择器里的展示顺序；默认角色是 chat。
 */
export const CHAT_ROLES: readonly ChatRoleConfig[] = [
  {
    id: 'chat',
    label: '闲聊',
    description: '围棋与日常聊天，纯对话，不接触插件/技能开发',
    icon: '💬',
    placeholder: '继续对话…',
    agent: false,
    skillDev: false,
    trace: false,
  },
  {
    id: 'dev',
    label: '开发',
    description: '写插件算子 / 技能配方并当场验收，也能把资源发布到 weiqi-assets',
    icon: '🛠️',
    placeholder: '描述技能或插件需求，或直接说触发词验收…',
    agent: true,
    skillDev: true,
    trace: true,
  },
] as const;

/** 默认角色：闲聊 */
export const DEFAULT_ROLE_ID: ChatRoleId = 'chat';

/** localStorage key：记住用户上次选的角色（新建会话时沿用） */
export const ROLE_STORAGE_KEY = 'chat:role';

/** 会话元数据里记录角色的字段名（角色绑定会话，历史不串味） */
export const ROLE_META_KEY = 'role';

export function getRole(id: ChatRoleId): ChatRoleConfig {
  return CHAT_ROLES.find((r) => r.id === id) ?? CHAT_ROLES[0]!;
}

/** 从任意字符串安全地解析角色 id；旧 plugin / skill-dev 合并映射到 dev */
export function parseRoleId(raw: unknown): ChatRoleId | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'plugin' || raw === 'skill-dev') return 'dev';
  return CHAT_ROLES.some((r) => r.id === raw) ? (raw as ChatRoleId) : undefined;
}
