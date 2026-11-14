/**
 * 对话页的「模型角色」定义
 * @module application/chat/ChatRole
 *
 * 背景：早期按用户每句话猜意图（白名单名词/动词/短句/承接上文），规则越堆
 * 越重、边界永远补不完，还出现过「用户说启用 → 被判闲聊 → 模型嘴上回已启用
 * 却什么都没执行」的假成功。
 *
 * 现在改成用户显式选角色：**角色确定后才挂对应的工具集与 system prompt**。
 * - chat（默认）：挂网页/PDF/图片工具，model 自主决定是否访问网络，没有插件写权限。
 * - plugin：挂插件工具集，注入实时插件清单 + 沙箱契约，能真实执行查看/编写/
 *   试算/启停/删除/应用/回滚等动作（全部是标准 tool_calls）。
 *
 * 扩展性：新增角色只需在 ROLES 里加一项（id / label / hint / 能力开关）并给
 * ChatUseCase 配一套 ToolKit，不需要再堆 if/else 猜措辞，也不需要新循环。
 */

/** 角色 id。字符串枚举便于持久化到 localStorage / 会话元数据。 */
export type ChatRoleId = 'chat' | 'plugin';

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
  /**
   * 是否挂插件工具集（标准 tool-calling 的 tools + 动态 system）。
   * 为 false 时该角色完全不接触插件系统。
   */
  agent: boolean;
  /** 是否展示过程日志（两个角色都按「真的执行过工具」懒建） */
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
    description: '围棋与日常聊天，纯对话，不接触插件系统',
    icon: '💬',
    placeholder: '继续对话…',
    agent: false,
    trace: false,
  },
  {
    id: 'plugin',
    label: '插件开发',
    description: '可编程智能体，可查看/编写/试算/启停/回滚插件，能真实执行',
    icon: '🧩',
    placeholder: '描述插件需求，或直接说「启用」…',
    agent: true,
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

/** 从任意字符串安全地解析角色 id（localStorage / 会话元数据可能脏） */
export function parseRoleId(raw: unknown): ChatRoleId | undefined {
  if (typeof raw !== 'string') return undefined;
  return CHAT_ROLES.some((r) => r.id === raw) ? (raw as ChatRoleId) : undefined;
}
