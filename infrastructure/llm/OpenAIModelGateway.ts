/**
 * OpenAI 兼容端点的模型网关实现
 * @module infrastructure/llm/OpenAIModelGateway
 *
 * 只做三件事：读凭据 → 把统一消息结构翻译成 OpenAI payload → 调
 * OpenAICompatibleClient（复用其超时、400 降级、截断判断）。
 * 不实现任何业务语义，业务语义在各 task 的调用方。
 */

import type {
  IModelGateway, ModelMessage, ModelPart, ModelRequest, ModelResult,
} from '../../application/model/IModelGateway';
import { OpenAICompatibleClient, type ChatMessage } from './OpenAICompatibleClient';
import { loadLLMConfig, loadApiKey } from './LLMCredentialStore';

/** 把统一消息结构降级成 OpenAI 的纯文本消息（多模态片段暂拼接为文本占位） */
function toChatMessages(messages: ModelMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : m.content.map(partToString).join('\n'),
  }));
}

/**
 * 一期不产生图片/文件片段；这里给出保守降级，避免二期接入前误传导致
 * 静默丢内容。真正支持视觉的端点应在二期按 task 直接构造原生 payload。
 */
function partToString(part: ModelPart): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'image':
      return `[图片:${part.mimeType ?? 'unknown'}]`;
    case 'file':
      return `[文件:${part.mimeType ?? 'unknown'}]`;
  }
}

export class OpenAIModelGateway implements IModelGateway {
  isReady(): boolean {
    const config = loadLLMConfig();
    if (!config || !config.model) return false;
    return loadApiKey() !== null;
  }

  async execute(req: ModelRequest): Promise<ModelResult> {
    // chat.reply：对话页主链路；plugin.generate：插件代码生成/修复循环。
    // 两者都走同一套纯文本 chat completions，只是调用方给的消息与 jsonMode 不同。
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

    // 对话不需要严格 JSON；意图解析路径仍走 OpenAICompatibleClient 默认 true。
    const jsonMode = req.options?.jsonMode ?? false;
    const result = await client.chat(toChatMessages(req.messages), { jsonMode });
    return { text: result.content, truncated: result.truncated };
  }
}
