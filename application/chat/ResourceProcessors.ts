/**
 * 资源 → 工具观察 / 历史附件的统一处理器
 * @module application/chat/ResourceProcessors
 *
 * 这是「设计上两种来源（URL / 本地）、两种 PDF 模式（端侧 / 原生）」的汇合点：
 * 工具层（web_read_pdf / web_read_image）与附件层（用户选本地文件）都调用它，
 * 得到统一的「文本观察 + 可选多模态 part + 历史附件」。
 *
 * 关键约束（与 WebToolLoop 的协议对齐）：
 * - role='tool' 观察永远是纯文本字符串，端点普遍不接受 tool 消息里的多模态 part。
 * - 图片 / 原生 PDF 的 base64 由 loop 在观察之后追加一条多模态 user 消息。
 * - 本模块只产出「要追加的 part + 要落历史的附件」，不碰消息数组。
 */

import type { ModelPart } from '../model/IModelGateway';
import type { ChatAttachment } from './ChatAttachment';
import { extractPdfText } from './PdfTextExtractor';
import { toDataUri, type ResourceInput } from './ResourceInput';

/** 一次处理的结果。observation 必为文本；parts / attachment 二选一或都有。 */
export interface ProcessedResource {
  observation: string;
  ok: boolean;
  detail: string;
  /** 需要 loop 追加的额外 user 消息 parts（图片 / 原生 PDF） */
  parts?: ModelPart[];
  /** 需要落会话历史的附件（支持多轮追问） */
  attachment?: ChatAttachment;
}

export type PdfMode = 'text' | 'native';

/** 从工具参数字符串里取 mode；非法值按默认 text，不抛错 */
export function parsePdfMode(raw: unknown): PdfMode {
  return raw === 'native' ? 'native' : 'text';
}

/**
 * 处理 PDF：默认端侧抽文本（对任何模型都成立）；mode=native 整份送模型。
 * 端侧抽不出文字（扫描版）时明确告知模型，不假装读过 —— 由模型决定改用
 * native 再调一次，或如实回答无法读取。
 */
export async function processPdf(
  resource: ResourceInput,
  mode: PdfMode,
): Promise<ProcessedResource> {
  const source = resource.sourceUrl ? ` ${resource.sourceUrl}` : '';
  if (mode === 'native') {
    const dataUri = toDataUri(resource.bytes, 'application/pdf');
    return {
      observation:
        `已取回 PDF《${resource.label}》${source}，按原生 PDF 送入模型，请直接阅读随附的文件内容。` +
        '若当前端点不支持原生 PDF 输入，它会返回错误；那时可改用 text 模式抽取文字层，或说明无法读取。',
      ok: true,
      detail: `${resource.label} → 原生 PDF（${resource.bytes.byteLength} 字节）`,
      parts: [{ type: 'file', uri: dataUri, mimeType: 'application/pdf', label: resource.label }],
      attachment: {
        kind: 'pdf-native',
        mimeType: 'application/pdf',
        dataUri,
        label: resource.label,
      },
    };
  }

  try {
    const extracted = await extractPdfText(resource.bytes);
    if (extracted.empty) {
      return {
        observation:
          `PDF《${resource.label}》${source} 共 ${extracted.pages} 页，但没有可提取的文字层` +
          '（可能是扫描件或纯图片）。请改用 native 模式把整份 PDF 交给模型，或如实说明无法读取。',
        ok: false,
        detail: `${resource.label} → 无文字层（${extracted.pages} 页）`,
      };
    }
    const prefix = `已端侧提取 PDF《${resource.label}》${source} 的文字（共 ${extracted.pages} 页）：\n\n`;
    return {
      observation: prefix + extracted.text,
      ok: true,
      detail: `${resource.label} → 文字 ${extracted.text.length} 字符 / ${extracted.pages} 页`,
      attachment: {
        kind: 'pdf-text',
        text: extracted.text,
        label: resource.label,
        ...(resource.sourceUrl ? { sourceUrl: resource.sourceUrl } : {}),
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      observation: `读取 PDF《${resource.label}》${source} 失败：${reason}。可改用 native 模式，或如实说明无法读取。`,
      ok: false,
      detail: `PDF 抽取失败：${reason}`,
    };
  }
}

/** 处理图片：转成 base64 的 image_url part（决策 3a，不传远程 URL） */
export function processImage(resource: ResourceInput): ProcessedResource {
  const dataUri = toDataUri(resource.bytes, resource.mimeType);
  const source = resource.sourceUrl ? ` ${resource.sourceUrl}` : '';
  return {
    observation: `已取回图片《${resource.label}》${source}，已作为随附图片送入模型，请直接查看图片内容。` +
      '若当前端点不支持图片输入，它会返回错误；那时请如实说明无法读取。',
    ok: true,
    detail: `${resource.label} → 图片（${resource.bytes.byteLength} 字节）`,
    parts: [{ type: 'image', uri: dataUri, mimeType: resource.mimeType, label: resource.label }],
    attachment: {
      kind: 'image',
      mimeType: resource.mimeType,
      dataUri,
      label: resource.label,
    },
  };
}
