/**
 * OpenAI 兼容的 Chat Completions 客户端
 * @module infrastructure/llm/OpenAICompatibleClient
 *
 * 两条链路共用底层 request()：
 * - chat()：功能助手 / 意图解析用的纯文本补全（保持原样，对空 content 抛错）。
 * - chatWithTools()：标准 tool-calling agent loop 用。模型可以只返回
 *   tool_calls 而没有 content，这是合法响应，不能按「空内容」判失败。
 *
 * 400 降级（reasoning_effort / json_mode 不被端点支持时去掉重试一次）
 * 由 request() 统一处理，两条链路共享。
 *
 * 2026-11-13：content 从 string 扩成 string | WireContentPart[]，支持图片
 * （image_url + data URI）与原生 PDF（file + file_data）。tool 消息仍保持
 * 纯文本：端点普遍不接受 role='tool' 里的多模态 part，观察文本单独走 text。
 */

import { buildChatCompletionsUrl } from './LLMCredentialStore';

/** OpenAI content part（多模态）。形状由 MultimodalTranslator 统一构造。 */
export type WireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

/** 工具声明（OpenAI tools[].function 形状） */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema 对象，直接透传给端点 */
    parameters: Record<string, unknown>;
  };
}

/** 模型发起的一次工具调用 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** 端点是字符串；这里原样透传，由上层 JSON.parse */
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 纯文本或多模态 part 数组（user / system 可用数组；tool 观察保持字符串） */
  content: string | WireContentPart[];
  /** role='assistant' 且模型发起工具调用时带 */
  tool_calls?: ToolCall[];
  /** role='tool' 时必带，与 ToolCall.id 对应 */
  tool_call_id?: string;
}

/** 一次纯文本补全的结果 */
export interface ChatResult {
  content: string;
  /** finish_reason=length：推理模型可能只是思考过程被掐断，content 仍可能完整 */
  truncated: boolean;
}

/** 一次带工具能力的补全结果 */
export interface ToolChatResult {
  /** 最终回复文本；模型仍在调工具时为空串 */
  content: string;
  /** 本轮模型发起的工具调用；没有则为 undefined */
  toolCalls?: ToolCall[];
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

/** request() 的公共返回，两条链路各自投影成自己的结果类型 */
interface RawCompletion {
  content: string;
  toolCalls?: ToolCall[];
  reasoningContent?: string;
  truncated: boolean;
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
   * 纯文本补全。功能助手与意图解析走这里，行为保持原样：
   * content 为空一律抛错（推理模型被掐断 / 只给思考过程 / 空回复）。
   *
   * @param jsonMode 是否要求严格 JSON 输出。意图解析需要（默认 true）；
   *   对话模式传 false，否则模型会被逼着吐 JSON。
   */
  async chat(messages: ChatMessage[], options?: { jsonMode?: boolean }): Promise<ChatResult> {
    const raw = await this.request(messages, options?.jsonMode ?? true, this.disableThinking, undefined);
    const content = raw.content;
    if (!content.trim()) {
      if (raw.truncated) {
        throw new Error(
          'LLM 思考过程占满了 token 预算，未输出正式回复；' +
          '请用 /llm maxtokens 8192 调大，或 /llm model 换非推理模型',
        );
      }
      if (raw.reasoningContent) {
        throw new Error('LLM 只返回了思考过程，未给出结果（建议换非推理模型）');
      }
      throw new Error('LLM 返回内容为空');
    }
    // truncated 只作为标记透传：推理模型常是 reasoning_content 被掐断而
    // content 里的 JSON 已完整，先交给上层解析，别在这里误杀
    return { content, truncated: raw.truncated };
  }

  /**
   * 标准 tool-calling 补全。与 chat() 的区别只有一个：模型只返回
   * tool_calls、content 为空是合法的中间状态，不能当失败。
   *
   * jsonMode 固定不启用 —— response_format=json_object 与 tool_calls 冲突，
   * 这是 OpenAI 协议约束，不是兼容性兜底。
   */
  async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ToolChatResult> {
    const raw = await this.request(messages, false, this.disableThinking, tools);
    return {
      content: raw.content,
      ...(raw.toolCalls ? { toolCalls: raw.toolCalls } : {}),
      truncated: raw.truncated,
    };
  }

  /**
   * @param withJsonMode 是否带 response_format。部分 OpenAI 兼容端点（Ollama、
   *   某些代理）不认这个字段会直接 400，此时自动去掉该字段重试一次；
   *   JSON 仍靠 system prompt 约束 + 上层容错解析保证。
   * @param withNoThinking 是否带 reasoning_effort: 'none'。部分端点不认这个字段
   *   会 400，同样自动去掉重试一次（此时退回模型默认行为）。
   * @param tools 带值时启用 tool-calling，同时强制不启用 jsonMode。
   */
  private async request(
    messages: ChatMessage[],
    withJsonMode: boolean,
    withNoThinking: boolean,
    tools?: ToolDefinition[],
  ): Promise<RawCompletion> {
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
      if (tools) {
        body['tools'] = tools;
        body['tool_choice'] = 'auto';
      } else if (withJsonMode) {
        body['response_format'] = { type: 'json_object' };
      }
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
          return this.request(messages, withJsonMode, false, tools);
        }
        // 400/422 且带了 json mode → 大概率是该字段不被支持，去掉重试一次
        if (badRequest && withJsonMode && !tools) {
          clearTimeout(timer);
          return this.request(messages, false, withNoThinking, tools);
        }
        const brief = detail.slice(0, 160).replace(/\s+/g, ' ');
        throw new Error(`LLM 请求失败 (HTTP ${response.status})${brief ? `：${brief}` : ''}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            /** 部分端点在多模态响应里也返回 content part 数组，这里统一拍平为文本 */
            content?: string | null | WireContentPart[];
            reasoning_content?: string;
            tool_calls?: Array<{
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };
      const choice = data.choices?.[0];
      const message = choice?.message;
      const content = Array.isArray(message?.content)
        ? message.content
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('')
        : (typeof message?.content === 'string' ? message.content : '');
      const truncated = choice?.finish_reason === 'length';

      // 规范化 tool_calls：缺 id / 非法 function 的条目直接丢弃，避免 loop 里
      // 拿着坏 id 回填 role:'tool' 被端点拒绝。
      const toolCalls: ToolCall[] | undefined = message?.tool_calls
        ?.filter((c) => typeof c.id === 'string' && c.id.length > 0
          && typeof c.function?.name === 'string' && c.function.name.length > 0)
        .map((c) => ({
          id: c.id!,
          type: 'function' as const,
          function: {
            name: c.function!.name!,
            arguments: typeof c.function!.arguments === 'string' ? c.function!.arguments : '',
          },
        }));

      return {
        content,
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
        ...(message?.reasoning_content ? { reasoningContent: message.reasoning_content } : {}),
        truncated,
      };
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
