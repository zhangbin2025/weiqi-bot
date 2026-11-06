/**
 * 插件调试过程的展示闸门
 * @module application/chat/PluginTraceVisibility
 *
 * 对话页的过程块叫「插件调试过程」，它只应该在**真的有插件代码、
 * 真的需要调试**时出现。此前只要走了 Agent Loop 就逐条推送步骤：
 * 能力询问（「能开发插件吗」）、查看清单、查看源码、启停插件都会
 * 先推「第 1 次决策：调用模型」「动作 none」「纯聊天回复」，于是
 * 用户只是问了句话，屏幕上也挂出一个插件开发过程。
 *
 * 这里按步骤内容做白名单过滤：
 * - 保留 codegen 的全部步骤（模型产出、提取源码、校验、沙箱试算、
 *   失败反馈）—— 这就是用户想看的代码调试过程，且它们都发生在
 *   plugin.create / plugin.revise 分支里。
 * - 保留任一带完整源码的步骤，以及 agent 侧的 validate / crash / sandbox。
 * - 丢弃 agent 的 decision / observe / final / protocol：那是智能体的
 *   内部编排与纯文本回复，不是代码调试。
 *
 * 过滤放在展示层（ChatUseCase），不改 Agent 自身的 trace ——
 * AgentTurnResult.trace 仍是完整审计记录，测试与其它调用方不受影响。
 *
 * 配合 ChatUseCase 的「懒建」：过程块在第一个通过本闸门的步骤到达时才创建，
 * 所以 plugin 角色下「启用 / 查看清单」这类零调试步骤的消息，屏幕上连空壳
 * 都不会出现。是否走 Agent 由角色决定，是否显示过程由本轮实际步骤决定。
 */

import type { PluginTraceStep } from '@domain/plugin/types';

/** agent 侧仍算「调试」的阶段：候选代码校验、崩溃、试算 */
const AGENT_DEBUG_PHASES: ReadonlySet<string> = new Set([
  'validate', 'crash', 'sandbox',
]);

/**
 * 这一步是否属于「插件代码 / 调试」过程，值得展示给用户。
 * 返回 false 的步骤不创建过程块、不追加行、也不参与全量兜底渲染。
 */
export function isDebugTraceStep(step: PluginTraceStep): boolean {
  // 代码生成循环：全程都是调试过程（模型产码 → 提取 → 校验 → 试算 → 修复）
  if (step.source === 'codegen') return true;
  // 任一带完整源码的步骤（例如 agent 回喂源码）
  if (typeof step.code === 'string' && step.code.trim()) return true;
  // agent 侧只有实质的代码校验/失败步骤才算
  return AGENT_DEBUG_PHASES.has(step.phase);
}

/** 从完整 trace 中挑出可展示的调试步骤（供全量兜底渲染） */
export function visibleDebugSteps(
  steps: readonly PluginTraceStep[] | undefined,
): PluginTraceStep[] {
  if (!steps || steps.length === 0) return [];
  return steps.filter(isDebugTraceStep);
}
