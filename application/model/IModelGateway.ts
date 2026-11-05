/**
 * 模型能力网关接口
 * @module application/model/IModelGateway
 *
 * 设计目标：把「调用 LLM」从「某个具体页面/某个具体任务」里解耦出来，
 * 后续接入 OCR 图片文字提取、PDF 表格解析等能力时，只需新增一个 task 分支
 * 和一个 UI 入口，聊天链路与凭据/超时/重试逻辑零改动。
 *
 * 一期只实现 `chat.reply`（纯文本多轮对话）；`ocr.image` / `doc.table`
 * 与图片/文件消息体仅作为类型占位，不产生、不实现。
 */

/** 模型任务标识。除已列出的保留字面量外开放扩展，便于二期新增能力。 */
export type ModelTaskId =
  | 'chat.reply'
  | 'ocr.image'   // 二期：图片文字提取
  | 'doc.table'   // 二期：PDF 表格解析
  | (string & {});

/** 多模态消息片段。一期只会产生 `text`。 */
export type ModelPart =
  | { type: 'text'; text: string }
  | { type: 'image'; uri: string; mimeType?: string }
  | { type: 'file'; uri: string; mimeType?: string };

/** 统一的对话消息。纯文本能力直接用 string，多模态能力用片段数组。 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ModelPart[];
}

export interface ModelRequest {
  task: ModelTaskId;
  messages: ModelMessage[];
  /** 可选覆盖：某能力想用不同模型/预算时传入，不传则用已保存的全局配置 */
  options?: {
    model?: string;
    maxTokens?: number;
    timeoutMs?: number;
    /** 是否要求端点输出严格 JSON。意图解析要 true，对话要 false。 */
    jsonMode?: boolean;
  };
}

export interface ModelResult {
  text: string;
  /** 结构化结果（表格 JSON、OCR 坐标等），纯文本能力省略 */
  structured?: unknown;
  truncated: boolean;
}

export interface IModelGateway {
  /** 凭据与模型是否可用（只读，不发起请求） */
  isReady(): boolean;
  execute(req: ModelRequest): Promise<ModelResult>;
}
