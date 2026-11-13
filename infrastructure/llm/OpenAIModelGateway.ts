/**
 * OpenAI 兼容端点的模型网关实现
 * @module infrastructure/llm/OpenAIModelGateway
 *
 * 职责：读凭据 → 把统一消息/工具结构翻译成 OpenAI payload → 调
 * OpenAICompatibleClient（复用其超时、400 降级、截断判断）。
 * 不实现任何业务语义，业务语义在各 task 的调用方。
 *
 * 两条链路：
 * - 带 tools → chatWithTools()，可返回 tool_calls（agent loop）
 * - 不带 tools → chat()，纯文本（意图解析 / 插件协议生成等旧链路）
 */

import type {
  IModelGateway, ModelMessage, ModelPart, ModelRequest, ModelResult,
  ModelToolCall, ModelToolDefinition,
} from '../../application/model/IModelGateway';
import {
  OpenAICompatibleClient,
  type ChatMessage, type ToolCall, type ToolDefinition,
} from './OpenAICompatibleClient';
import { modelPartsToWire } from './MultimodalTranslator';
import { loadLLMConfig, loadApiKey } from './LLMCredentialStore';

/**
 * 把统一消息结构翻译成 OpenAI 消息。
 * - 纯文本 content 原样透传（tool 观察 / 普通对话）
 * - ModelPart[] 交给 MultimodalTranslator 变成真正的多模态 part
 *   （image_url + data URI / file + file_data），不再降级成占位文本。
 */
function toChatMessages(messages: ModelMessage[]): ChatMessage[] {
  return messages.map((m): ChatMessage => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : modelPartsToWire(m.content),
    ...(m.tool_calls ? { tool_calls: m.tool_calls.map(toWireToolCall) } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
  }));
}

function toWireToolCall(call: ModelToolCall): ToolCall {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  };
}

function toWireToolDefinition(tool: ModelToolDefinition): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function fromWireToolCall(call: ToolCall): ModelToolCall {
  return {
    id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  };
}

export class OpenAIModelGateway implements IModelGateway {
  isReady(): boolean {
    const config = loadLLMConfig();
    if (!config || !config.model) return false;
    return loadApiKey() !== null;
  }

  async execute(req: ModelRequest): Promise<ModelResult> {
    // 任务白名单保留：这两个 task 都走纯文本 chat completions，
    // 只是调用方给的消息、jsonMode 与 tools 不同。
    if (req.task !== 'chat.reply' && req.task !== 'plugin.generate') {
      throw new Error(`模型能力「${req.task}」尚未实现`);
    }

    const config = loadLLMConfig();
    if (!config) throw new Error('尚未配置 LLM，请到功能助手执行 /llm 配置');
    const apiKey = loadApiKey();
    if (!apiKey) throw new Error('凭据无法解密，请到功能助手重新执行 /llm 配置');
    const model = req.options?.model ?? config.model;
    if (!model) throw new Error('未指定模型，请到功能助手执行 /llm model <模型名>');

    const client = new OpenAICompatibleClient({
      baseUrl: config.baseUrl,
      apiKey,
      model,
      // exactOptionalPropertyTypes：只在有值时传
      ...(req.options?.maxTokens !== undefined
        ? { maxTokens: req.options.maxTokens }
        : (config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {})),
      ...(req.options?.timeoutMs !== undefined
        ? { timeoutMs: req.options.timeoutMs }
        : (config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {})),
      ...(config.disableThinking !== undefined
        ? { disableThinking: config.disableThinking } : {}),
    });

    const chatMessages = toChatMessages(req.messages);

    if (req.tools && req.tools.length > 0) {
      const result = await client.chatWithTools(chatMessages, req.tools.map(toWireToolDefinition));
      return {
        text: result.content,
        ...(result.toolCalls ? { toolCalls: result.toolCalls.map(fromWireToolCall) } : {}),
        truncated: result.truncated,
      };
    }

    // 对话不需要严格 JSON；意图解析路径仍走 OpenAICompatibleClient 默认 true。
    const jsonMode = req.options?.jsonMode ?? false;
    const result = await client.chat(chatMessages, { jsonMode });
    return { text: result.content, truncated: result.truncated };
  }
}
