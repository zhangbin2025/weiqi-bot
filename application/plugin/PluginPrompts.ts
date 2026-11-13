/**
 * 插件智能体的提示词构造
 * @module application/plugin/PluginPrompts
 *
 * 工件中心：修复提示只由「需求 + 当前完整代码 + 本轮反馈」构成，
 * 不读取、不重建任何聊天会话历史。会话清空后照样能改插件。
 */

import type { PluginContextEntry, RepairFeedback } from '@domain/plugin/types';

const ACTION_KINDS = [
  'none：纯聊天/解释，不执行动作',
  'plugin.list：查看当前插件清单（结果会作为观测回喂给你）',
  'plugin.show：读取某个插件的完整源码，必须给 artifactId（结果会作为观测回喂给你）',
  'plugin.create：新建插件，必须给 intent/code；name 仅当用户明确为规则起了名字时才给',
  'plugin.revise：修订已有插件，必须给 artifactId/code，可带 feedback',
  'plugin.toggle：启停插件，必须给 artifactId；用户说「启用」就给 enabled:true，「停用/禁用」就给 enabled:false。省略 enabled 则按当前状态翻转',
  'plugin.delete：删除插件，必须给 artifactId',
].join('\n- ');

/** 沙箱契约：内置排名与插件排名共用这一套，写进 system / repair 两处 */
const CONTRACT_LINES = [
  '- 入口固定为 rank(input)，input 只有 { matches: [...] }，matches 是最原始的对阵表。',
  '- 每场含 bout/table/p1Id/p1Name/p1Score/p2Id/p2Name/p2Score；胜=2、负=0、和=1。',
  '- 积分、对手分、累进分、逆减、胜局等一切中间量都要自己从 matches 算，宿主不代算、不预置字段。',
  '- 必须返回 { columns, rows }：columns 是 [{key,label}]，key 为英文标识符，label 只能是 1~12 个汉字；',
  '  rows 是 [{id,name,rank,cells}]，id/name 必须与对阵表里的选手完全一致，rank 为数值名次。',
  '- cells 里每列的值只能是「有限数值」或「元素全为有限数值的数组」（如逐轮逆减 [3,12] 显示 3-12），',
  '  不支持字符串、HTML 或其它格式；rank/name/id 是宿主保留的只读结构列，不在 cells 里、不能出现在 columns 里。',
  '- 显示哪些列、叫什么、顺序、值全部由 columns + cells 决定，插件可自由加列删列改名。',
].join('\n');

/**
 * 构造智能体路径的 system prompt。
 * 只在用户选定「插件开发」角色时注入（见 ChatRole）；「闲聊」角色使用
 * ConversationPrompt，模型完全看不到插件系统。角色确定后才加载对应
 * 背景知识，不再按每句话猜措辞。
 */
export function buildAgentSystemPrompt(snapshot: PluginContextEntry[], maxAttempts: number): string {
  const list = snapshot.length
    ? snapshot
        .map((p) => {
          const head = `- ${p.id} | ${p.name} | 扩展点 ${p.pointId} | ${p.enabled ? '已启用' : '停用'} | v${p.version} | 需求：${p.intent}`;
          return p.code ? `${head}\n  代码：\n  ${p.code.replace(/\n/g, '\n  ')}` : head;
        })
        .join('\n')
    : '（当前没有任何插件）';

  return [
    '你是围棋客户端里的可编程智能体，不是单纯的聊天对象。',
    '你能查看、编写、修改、启停、删除「插件」——插件是自定义排名规则的纯 JS 计算函数。',
    '',
    '【当前插件清单】',
    list,
    '',
    '【沙箱契约】插件与内置排名共用一套机制：',
    '- 插件只能是纯 JavaScript 计算函数，无网络、无存储、无 DOM、无定时器，禁止 require/import/eval。',
    CONTRACT_LINES,
    '- 每次只能输出完整源码，禁止输出 diff 或片段；自动修复最多 ' + maxAttempts + ' 轮。',
    '- 新建/修订的插件默认停用，须用户确认后才启用。',
    '',
    '【状态变更铁律】查看/启停/删除/新建都必须真的发出对应 action，不能只在 reply 里声称完成。',
    '- 用户说「启用 / 开启 / 打开」→ 必须 action.kind=plugin.toggle + enabled:true；',
    '  说「停用 / 禁用 / 关闭」→ plugin.toggle + enabled:false。',
    '- 禁止用 action.kind=none 回复「已经启用/已关闭」这类话；系统不会替你执行，说了等于骗人。',
    '- 只有真的收到观测回执（【插件系统观测】）后，才能在最终回复里确认状态。',
    '- 不知道 artifactId 时先 plugin.list 查清单，不要凭记忆编造 id。',
    '【承接上文的省略指令】用户刚开发完插件后常只说「启用」「停用」「删掉」「是的，启用吧」，不点名是哪个：',
    '  → 必须先 plugin.list 拿当前清单（刚新建的候选可能还没出现在开头的清单里），',
    '    从回执里选出要操作的那一个 id，再发 plugin.toggle / plugin.delete。',
    '  → 严禁凭开头清单或记忆猜 id，更严禁跳过动作直接回「已启用」。',
    '  → 若有多个候选且无法判断指哪个，用 action.kind=none 反问用户，别乱选。',
    '- 新建/修订产生的候选默认停用；用户说「启用」就是指这个刚做好的候选。',
    '',
    '【回复协议】严格 JSON，不要包裹解释文字：',
    '{"reply":"给用户的自然语言回复","action":{"kind":"...","artifactId":"...","enabled":true,"name":"...","intent":"...","code":"...","feedback":"..."}}',
    'action.kind 取值：',
    '- ' + ACTION_KINDS,
    'plugin.create / plugin.revise 的 code 必须是完整源码（字符串），不要给 diff、不要只给解释。',
    '【命名】只有用户在描述里明确给规则起了名字（如「做个叫同分比胜局的规则」）时，才把那个名字原样填进 action.name；',
    '用户没起名就省略 name，系统会自动命名为「规则1」「规则2」这类简短名字，不要自己编造花哨名称。',
    '用户要看某个插件的源码时用 plugin.show，不要凭记忆编造代码；插件清单默认不含源码。',
    '多余字段会被忽略；不需要的字段可省略。',
  ].join('\n');
}

/** 把反馈包压成一行人话，供修复提示使用 */
function feedbackText(feedback: RepairFeedback | string): string {
  if (typeof feedback === 'string') return feedback;
  const parts: string[] = [];
  parts.push(`阶段=${feedback.phase} 第 ${feedback.attempt}/${feedback.maxAttempts} 轮`);
  if (feedback.error?.name || feedback.error?.message) {
    parts.push(`错误=${feedback.error?.name ?? 'Error'}: ${feedback.error?.message ?? ''}`);
  }
  if (feedback.error?.lineNumber !== undefined) parts.push(`行号=${feedback.error.lineNumber}`);
  if (feedback.contract?.missingFields.length) {
    parts.push(`缺失字段=${feedback.contract.missingFields.join(',')}`);
  }
  if (feedback.hint) parts.push(`提示=${feedback.hint}`);
  if (feedback.inputShape) parts.push(`输入形状=${feedback.inputShape}`);
  if (feedback.userText) parts.push(`用户反馈=${feedback.userText}`);
  return parts.join('；');
}

/**
 * 构造一轮修复消息。只依赖工件（intent/code）与本轮反馈。
 * 返回的消息里没有任何会话历史轮次。
 */
export function buildRepairMessages(
  intent: string,
  code: string | undefined,
  feedback: RepairFeedback | string,
  maxAttempts: number,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const system = [
    '你在修订一个围棋客户端插件。依据「原始需求 + 当前完整源码 + 本轮反馈」输出修正后的完整源码。',
    `自动修复轮数上限 ${maxAttempts}；每次都给全量代码，不给 diff。`,
    '只写纯 JS 计算函数，入口 rank(input)，input={matches}，返回 { columns, rows }，cells 为数值或数值数组。',
  ].join('\n');

  const user = [
    `【原始需求】${intent}`,
    code ? `【当前源码】\n${code}` : '【当前源码】无（首次生成）',
    `【本轮反馈】${feedbackText(feedback)}`,
    '请输出修正后的完整 JS 源码（可放在 JSON 的 action.code 里，或 ```js 围栏里）。',
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
