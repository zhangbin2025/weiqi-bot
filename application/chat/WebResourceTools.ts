/**
 * 宿主级工具：读取网络 PDF / 图片
 * @module application/chat/WebResourceTools
 *
 * web_fetch 保持第一版职责（只回文本）零改动；PDF/图片作为独立工具登记，
 * 让模型自己区分「读文字」「读版面 / 看图」。URL 防护、超时、失败变观察
 * 全部复用 WebFetchTool 的既有口径。
 *
 * 两种来源最终汇合：URL 走这里；本地文件由 ChatUseCase 附件链路直接调用
 * 同一个 ResourceProcessors（用户已经给了文件，模型无从「决定」读取）。
 */

import type { ModelToolDefinition, ModelPart } from '../model/IModelGateway';
import type { ChatAttachment } from './ChatAttachment';
import { fetchResourceFromUrl } from './ResourceInput';
import { parsePdfMode, processImage, processPdf } from './ResourceProcessors';
import type { WebFetchToolDeps } from './WebFetchTool';

export const WEB_READ_PDF_TOOL_NAME = 'web_read_pdf';
export const WEB_READ_IMAGE_TOOL_NAME = 'web_read_image';

const urlParam = {
  type: 'string',
  description: '公开资源的绝对 URL，必须是 http:// 或 https:// 开头',
} as const;

export const WEB_READ_PDF_TOOL: ModelToolDefinition = {
  name: WEB_READ_PDF_TOOL_NAME,
  description:
    '读取一个公开 PDF 并返回内容。默认 mode=text：在端侧抽取文字层，适合有文字的 PDF；' +
    '扫描件、需要看版式 / 图表时用 mode=native，把整份 PDF 直接交给模型阅读' +
    '（需要当前端点支持原生 PDF 输入，不支持时会明确失败）。' +
    '只用于 GET；只传 http/https 绝对 URL。',
  parameters: {
    type: 'object',
    properties: {
      url: urlParam,
      mode: {
        type: 'string',
        enum: ['text', 'native'],
        description: 'text=端侧抽文字（默认）；native=整份 PDF 送模型',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

export const WEB_READ_IMAGE_TOOL: ModelToolDefinition = {
  name: WEB_READ_IMAGE_TOOL_NAME,
  description:
    '读取一个公开图片（PNG/JPEG/GIF/WebP/BMP），把图片本身送入模型查看，' +
    '适合识别图中文字、棋谱、表格、截图内容。' +
    '需要当前端点支持图片输入，不支持时会明确失败。' +
    '只用于 GET；只传 http/https 绝对 URL。',
  parameters: {
    type: 'object',
    properties: { url: urlParam },
    required: ['url'],
    additionalProperties: false,
  },
};

/** 工具执行结果：观察文本 + 过程摘要 + 可选额外 parts / 历史附件 */
export interface WebResourceToolResult {
  observation: string;
  ok: boolean;
  detail: string;
  parts?: ModelPart[];
  attachment?: ChatAttachment;
}

/** 从参数 JSON 取 url；失败文案直接作为观察回给模型 */
function readUrl(argsJson: string): { url: string } | { error: string } {
  try {
    const args = JSON.parse(argsJson) as { url?: unknown };
    if (typeof args.url !== 'string' || !args.url.trim()) {
      return { error: '缺少 url 参数' };
    }
    return { url: args.url.trim() };
  } catch {
    return { error: '参数不是合法 JSON' };
  }
}

/** 期望种类与实际不符时，明确告知模型换工具，不静默按错种类处理 */
function mismatch(name: string, actual: string): WebResourceToolResult {
  const hint = actual === 'pdf'
    ? `请改用 ${WEB_READ_PDF_TOOL_NAME}`
    : actual === 'image'
      ? `请改用 ${WEB_READ_IMAGE_TOOL_NAME}`
      : '该资源类型不受支持，请如实说明无法读取';
  const label = actual === 'pdf' ? 'PDF' : actual === 'image' ? '图片' : '不受支持的资源';
  return {
    observation: `${name}：目标资源是 ${label}，与工具用途不符。${hint}。`,
    ok: false,
    detail: `资源种类不符：${actual}`,
  };
}

export async function executeWebReadPdf(
  argsJson: string,
  deps: WebFetchToolDeps,
): Promise<WebResourceToolResult> {
  const parsed = readUrl(argsJson);
  if ('error' in parsed) {
    return { observation: `${WEB_READ_PDF_TOOL_NAME} 参数无效：${parsed.error}`, ok: false, detail: parsed.error };
  }
  let mode: 'text' | 'native' = 'text';
  try {
    mode = parsePdfMode((JSON.parse(argsJson) as { mode?: unknown }).mode);
  } catch { /* 默认 text */ }

  const fetched = await fetchResourceFromUrl(parsed.url, deps);
  if (!fetched.ok) {
    return { observation: `${WEB_READ_PDF_TOOL_NAME}：${fetched.error}`, ok: false, detail: fetched.error };
  }
  if (fetched.resource.kind !== 'pdf') return mismatch(WEB_READ_PDF_TOOL_NAME, fetched.resource.kind);
  return processPdf(fetched.resource, mode);
}

export async function executeWebReadImage(
  argsJson: string,
  deps: WebFetchToolDeps,
): Promise<WebResourceToolResult> {
  const parsed = readUrl(argsJson);
  if ('error' in parsed) {
    return { observation: `${WEB_READ_IMAGE_TOOL_NAME} 参数无效：${parsed.error}`, ok: false, detail: parsed.error };
  }
  const fetched = await fetchResourceFromUrl(parsed.url, deps);
  if (!fetched.ok) {
    return { observation: `${WEB_READ_IMAGE_TOOL_NAME}：${fetched.error}`, ok: false, detail: fetched.error };
  }
  if (fetched.resource.kind !== 'image') return mismatch(WEB_READ_IMAGE_TOOL_NAME, fetched.resource.kind);
  return processImage(fetched.resource);
}
