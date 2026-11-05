/**
 * OpenAI 兼容的 Chat Completions 客户端
 * @module infrastructure/llm/OpenAICompatibleClient
 *
 * 只做一件事：把 system + 当前句发给 /chat/completions，拿回字符串内容。
 * 不做意图解析，交给上层 LLMIntentProvider。
 */

import { buildChatCompletionsUrl } from './LLMCredentialStore';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 一次补全的结果 */
export interface ChatResult {
  content: string;
  /** finish_reason=length：推理模型可能只是思考过程被掐断，content 仍可能完整 */
  truncated: boolean;
}

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** 超时（毫秒），默认 60s（推理模型闲聊较慢） */
  timeoutMs?: number;
  /**
   * 单次补全 token 预算，默认 4096。
   * 推理模型的 reasoning_content 与 content 共享预算，1024 常被思考过程吃光
   * 导致 content 为空、finish_reason=length（真截断）。调 timeout 无用。
   */
  maxTokens?: number;
  /** 是否关闭推理模型的思考过程，默认 true（发 reasoning_effort: 'none'） */
  disableThinking?: boolean;
}

export class OpenAICompatibleClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly disableThinking: boolean;

  constructor(config: OpenAICompatibleConfig) {
    this.endpoint = buildChatCompletionsUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    // 不再兜底任何默认模型：各家 ID 不同，写死会直接 400 invalid model
    this.model = config.model || '';
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxTokens = config.maxTokens ?? 4096;
    this.disableThinking = config.disableThinking ?? true;
  }

  /**
   * 请求一次补全，返回 assistant 的文本内容。
   * 失败一律抛错，由调用方决定提示文案（不回落本地识别）。
   *
   * @param jsonMode 是否要求严格 JSON 输出。意图解析需要（默认 true，保持
   *   功能助手原有行为不变）；对话模式传 false，否则模型会被逼着吐 JSON。
   */
  async chat(messages: ChatMessage[], options?: { jsonMode?: boolean }): Promise<ChatResult> {
    return this.request(messages, options?.jsonMode ?? true, this.disableThinking);
  }

  /**
   * @param withJsonMode 是否带 response_format。部分 OpenAI 兼容端点（Ollama、
   *   某些代理）不认这个字段会直接 400，此时自动去掉该字段重试一次；
   *   JSON 仍靠 system prompt 约束 + 上层容错解析保证。
   * @param withNoThinking 是否带 reasoning_effort: 'none'。部分端点不认这个字段
   *   会 400，同样自动去掉重试一次（此时退回模型默认行为）。
   */
  private async request(
    messages: ChatMessage[],
    withJsonMode: boolean,
    withNoThinking: boolean,
  ): Promise<ChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        temperature: 0.1,
        stream: false,
        max_tokens: this.maxTokens,
      };
      if (withJsonMode) body['response_format'] = { type: 'json_object' };
      // 推理模型默认关思考：实测腾讯 lkeap 只认 'none'（reasoning_tokens=0），
      // 'minimal'/'low' 反而会烧满预算导致 content 为空
      if (withNoThinking) body['reasoning_effort'] = 'none';

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const badRequest = response.status === 400 || response.status === 422;
        // 端点不认 reasoning_effort → 去掉重试一次（优先于 json mode 降级）
        if (badRequest && withNoThinking && /reasoning_effort|thinking|effort/i.test(detail)) {
          clearTimeout(timer);
          return this.request(messages, withJsonMode, false);
        }
        // 400/422 且带了 json mode → 大概率是该字段不被支持，去掉重试一次
        if (badRequest && withJsonMode) {
          clearTimeout(timer);
          return this.request(messages, false, withNoThinking);
        }
        const brief = detail.slice(0, 160).replace(/\s+/g, ' ');
        throw new Error(`LLM 请求失败 (HTTP ${response.status})${brief ? `：${brief}` : ''}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: { content?: string; reasoning_content?: string };
          finish_reason?: string;
        }>;
      };
      const choice = data.choices?.[0];
      const message = choice?.message;
      // 推理模型（如 tc-code-latest）在 token 不够时可能 content 为空、
      // 内容全在 reasoning_content；此时明确报错而不是吞掉
      const content = typeof message?.content === 'string' ? message.content : '';
      const truncated = choice?.finish_reason === 'length';
      if (!content.trim()) {
        if (truncated) {
          throw new Error(
            'LLM 思考过程占满了 token 预算，未输出正式回复；' +
            '请用 /llm maxtokens 8192 调大，或 /llm model 换非推理模型',
          );
        }
        if (message?.reasoning_content) {
          throw new Error('LLM 只返回了思考过程，未给出结果（建议换非推理模型）');
        }
        throw new Error('LLM 返回内容为空');
      }
      // truncated 只作为标记透传：推理模型常是 reasoning_content 被掐断而
      // content 里的 JSON 已完整，先交给上层解析，别在这里误杀
      return { content, truncated };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `LLM 请求超时（${this.timeoutMs / 1000}s）。推理模型闲聊较慢，` +
          `可用 /llm timeout <秒> 调大，或 /llm model 换非推理模型`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
