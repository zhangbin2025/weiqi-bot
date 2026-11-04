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

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** 超时（毫秒），默认 20s */
  timeoutMs?: number;
}

export class OpenAICompatibleClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    this.endpoint = buildChatCompletionsUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.timeoutMs = config.timeoutMs ?? 20000;
  }

  /**
   * 请求一次补全，返回 assistant 的文本内容。
   * 失败一律抛错，由调用方决定提示文案（不回落本地识别）。
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    return this.request(messages, true);
  }

  /**
   * @param withJsonMode 是否带 response_format。部分 OpenAI 兼容端点（Ollama、
   *   某些代理）不认这个字段会直接 400，此时自动去掉该字段重试一次；
   *   JSON 仍靠 system prompt 约束 + 上层容错解析保证。
   */
  private async request(messages: ChatMessage[], withJsonMode: boolean): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        temperature: 0.1,
        stream: false,
      };
      if (withJsonMode) body['response_format'] = { type: 'json_object' };

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
        // 400/422 且带了 json mode → 大概率是该字段不被支持，去掉重试一次
        if (withJsonMode && (response.status === 400 || response.status === 422)) {
          clearTimeout(timer);
          return this.request(messages, false);
        }
        const brief = detail.slice(0, 160).replace(/\s+/g, ' ');
        throw new Error(`LLM 请求失败 (HTTP ${response.status})${brief ? `：${brief}` : ''}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('LLM 返回内容为空');
      }
      return content;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LLM 请求超时（${this.timeoutMs / 1000}s）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
