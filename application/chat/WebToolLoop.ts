/**
 * 闲聊角色的网络工具薄封装
 * @module application/chat/WebToolLoop
 *
 * 循环本身已抽到 ToolLoop.ts（chat 与 plugin 共用的唯一引擎）。
 * 本文件只负责把三个网络工具 + 注入依赖绑成一套 ToolKit，
 * 保持 runWebToolLoop 的既有签名与全部行为，供闲聊角色与既有测试使用。
 */

import type { IModelGateway } from '../model/IModelGateway';
import type { PluginTraceStep } from '@domain/plugin/types';
import type { ChatAttachment } from './ChatAttachment';
import { WEB_FETCH_TOOL, WEB_FETCH_TOOL_NAME, executeWebFetch } from './WebFetchTool';
import type { WebFetchToolDeps } from './WebFetchTool';
import {
  WEB_READ_PDF_TOOL, WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL, WEB_READ_IMAGE_TOOL_NAME,
  executeWebReadPdf, executeWebReadImage,
} from './WebResourceTools';
import { runToolLoop, type ToolKit, type ToolLoopResult, type ToolOutcome } from './ToolLoop';

/** 网络智能体过程步骤；source='web' 与插件调试步骤区分，展示层各自过滤 */
export type WebTraceStep = Omit<PluginTraceStep, 'source'> & { source: 'web' };

/** 实时过程推送（纯展示通道，绝不写会话历史） */
export type WebTraceSink = (step: WebTraceStep) => void;

export interface WebToolLoopDeps {
  gateway: IModelGateway;
  /** 工具执行依赖（proxyUrl / timeoutMs / 可替换 fetch） */
  toolDeps: WebFetchToolDeps;
}

export interface WebToolLoopRequest {
  /** 已含 system + 历史 + 当前句的完整消息数组 */
  messages: Parameters<typeof runToolLoop>[1]['messages'];
  onTrace?: WebTraceSink;
}

export interface WebToolLoopResult extends ToolLoopResult {}

/** 工具表：唯一的扩展点，新增网络能力在这里登记 */
export const WEB_TOOLS = [
  WEB_FETCH_TOOL,
  WEB_READ_PDF_TOOL,
  WEB_READ_IMAGE_TOOL,
] as const;

/** 跑一次完整的 agent turn（闲聊/网页能力）；行为与通用 loop 完全一致 */
export async function runWebToolLoop(
  deps: WebToolLoopDeps,
  req: WebToolLoopRequest,
): Promise<WebToolLoopResult> {
  const executors: Record<string, (argsJson: string) => Promise<ToolOutcome>> = {
    [WEB_FETCH_TOOL_NAME]: (args) => executeWebFetch(args, deps.toolDeps),
    [WEB_READ_PDF_TOOL_NAME]: (args) => executeWebReadPdf(args, deps.toolDeps),
    [WEB_READ_IMAGE_TOOL_NAME]: (args) => executeWebReadImage(args, deps.toolDeps),
  };
  return runToolLoop(
    {
      gateway: deps.gateway,
      tools: [...WEB_TOOLS],
      executors,
      source: 'web',
    },
    {
      messages: req.messages,
      ...(req.onTrace ? { onTrace: req.onTrace as (s: PluginTraceStep) => void } : {}),
    },
  );
}

/** 供上层按角色选择工具集时复用（闲聊角色不覆盖 system、用默认轮数上限） */
export function createWebToolKit(toolDeps: WebFetchToolDeps): ToolKit {
  return {
    tools: [...WEB_TOOLS],
    executors: {
      [WEB_FETCH_TOOL_NAME]: (args) => executeWebFetch(args, toolDeps),
      [WEB_READ_PDF_TOOL_NAME]: (args) => executeWebReadPdf(args, toolDeps),
      [WEB_READ_IMAGE_TOOL_NAME]: (args) => executeWebReadImage(args, toolDeps),
    },
  };
}

/** 类型重导出，便于其它模块不直接依赖 ToolLoop 内部形状 */
export type { ChatAttachment };
