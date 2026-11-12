/**
 * 模型能力网关接口
 * @module application/model/IModelGateway
 *
 * 统一「调用 LLM」的契约。除了纯文本多轮对话（chat.reply），本层也承载
 * 标准 tool-calling：调用方在 ModelRequest 里声明 tools，模型可返回
 * tool_calls，宿主执行后以 role:'tool' 回填观察再决策 —— 这就是
 * tool-calling agent loop 的规范形状（决策权在模型，宿主只提供工具与观察）。
 *
 * 本文件只定义抽象契约；wire 级字段（tool_choice / function.arguments 等）
 * 由 infrastructure/llm/OpenAICompatibleClient 负责构造与翻译。
 */

/** 模型任务标识。除已列出的保留字面量外开放扩展，便于后续新增能力。 */
export type ModelTaskId =
  | 'chat.reply'
  | 'plugin.generate'
  | (string & {});

/** 多模态消息片段。当前只产生 `text`。 */
export type ModelPart =
  | { type: 'text'; text: string }
  | { type: 'image'; uri: string; mimeType?: string }
  | { type: 'file'; uri: string; mimeType?: string };

/** 暴露给模型的工具声明（抽象形状，wire 构造在基础设施层） */
export interface ModelToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 对象 */
  parameters: Record<string, unknown>;
}

/** 模型发起的一次工具调用 */
export interface ModelToolCall {
  id: string;
  name: string;
  /** 端点是字符串，由工具实现负责 JSON.parse */
  arguments: string;
}

/** 统一的对话消息。tool 角色与 tool_calls / tool_call_id 为 agent loop 专用。 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ModelPart[];
  /** assistant 发起工具调用时带 */
  tool_calls?: ModelToolCall[];
  /** role='tool' 时必带，与 ModelToolCall.id 对应 */
  tool_call_id?: string;
}

export interface ModelRequest {
  task: ModelTaskId;
  messages: ModelMessage[];
  /** 声明本轮可用工具；带值时网关走 chatWithTools 链路 */
  tools?: ModelToolDefinition[];
  /** 可选覆盖：某能力想用不同模型/预算时传入，不传则用已保存的全局配置 */
  options?: {
    model?: string;
    maxTokens?: number;
    timeoutMs?: number;
    /** 是否要求端点输出严格 JSON。意图解析要 true，对话要 false。带 tools 时忽略。 */
    jsonMode?: boolean;
  };
}

export interface ModelResult {
  /** 最终回复文本；模型仍在调工具时为空串 */
  text: string;
  /** 本轮模型发起的工具调用；没有则省略 */
  toolCalls?: ModelToolCall[];
  /** 结构化结果（表格 JSON、OCR 坐标等），纯文本能力省略 */
  structured?: unknown;
  truncated: boolean;
}

export interface IModelGateway {
  /** 凭据与模型是否可用（只读，不发起请求） */
  isReady(): boolean;
  execute(req: ModelRequest): Promise<ModelResult>;
}
