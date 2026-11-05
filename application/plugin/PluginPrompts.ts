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
  'plugin.create：新建插件，必须给 name/intent/code',
  'plugin.revise：修订已有插件，必须给 artifactId/code，可带 feedback',
  'plugin.toggle：启停插件，必须给 artifactId',
  'plugin.delete：删除插件，必须给 artifactId',
].join('\n- ');

/** 构造注入每次请求的 system prompt（插件系统对 LLM 始终可见） */
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
    '你能查看、编写、修改、启停、删除「插件」——插件是用户自定义排名规则的纯 JS 计算函数。',
    '',
    '【当前插件清单】',
    list,
    '',
    '【沙箱契约】',
    '- 插件只能是纯 JavaScript 计算函数，无网络、无存储、无 DOM、无定时器，禁止 require/import/eval。',
    '- 排名扩展点入口函数名固定为 rank(players)，输入是选手对象数组（含 id/name/score/wins 等字段）。',
    '- 必须返回数组，每行保留原 id 并给出数值 rank；宿主按 rank 重排。',
    '- 每次只能输出完整源码，禁止输出 diff 或片段；自动修复最多 ' + maxAttempts + ' 轮。',
    '- 新建/修订的插件默认停用，须用户确认后才启用。',
    '',
    '【回复协议】严格 JSON，不要包裹解释文字：',
    '{"reply":"给用户的自然语言回复","action":{"kind":"...","artifactId":"...","name":"...","intent":"...","code":"...","feedback":"..."}}',
    'action.kind 取值：',
    '- ' + ACTION_KINDS,
    'plugin.create / plugin.revise 的 code 必须是完整源码（字符串），不要给 diff、不要只给解释。',
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
    '只写纯 JS 计算函数，入口 rank(players)，返回带 id 与数值 rank 的数组。',
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
