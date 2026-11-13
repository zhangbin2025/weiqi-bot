/**
 * 会话历史里的「附件」类型与重放逻辑
 * @module application/chat/ChatAttachment
 *
 * 2026-11-13 决策（第 6 点）：PDF/图片提取后的文字或 base64 落入历史，
 * 支持多轮追问。刻意作为 ChatMessage 的独立字段，不塞进 content ——
 * 否则 marked 会把 base64 当正文渲染、会话标题截到一串 base64、
 * splitMessageByUrls 的 URL 卡片也会误伤（昨晚刚修过那处）。
 *
 * 数值口径（第 5 点选 A，零新常数）：
 * - 附件不计入 CONTEXT_LIMITS 的字符预算（否则一张图的 base64 必被
 *   maxCharsPerMessage=2000 截断，模型收到半张图且无任何报错）。
 * - 附件随其所在的消息一起受 maxMessages=20 窗口约束，天然限量。
 * - 不新设字节上限：超出端点/浏览器能力时由失败路径变观察，不静默截断。
 */

import type { ModelPart } from '../model/IModelGateway';

export type ChatAttachment =
  /** 端侧抽出的 PDF 文字层（文本，可直接进上下文） */
  | { kind: 'pdf-text'; text: string; label: string; sourceUrl?: string }
  /** 原生 PDF 的 base64（送模型原生 PDF 能力） */
  | { kind: 'pdf-native'; mimeType: string; dataUri: string; label: string }
  /** 图片的 base64（送 vision 端点） */
  | { kind: 'image'; mimeType: string; dataUri: string; label: string };

/** 展示用摘要：历史气泡 / 会话列表只显示这个，绝不打印 base64 正文 */
export function describeAttachment(a: ChatAttachment): string {
  switch (a.kind) {
    case 'pdf-text': return `📄 ${a.label}（已提取文字）`;
    case 'pdf-native': return `📄 ${a.label}（原文）`;
    case 'image': return `🖼️ ${a.label}`;
  }
}

/**
 * 历史附件 → 模型多模态片段。
 * pdf-text 生成带来源标注的 text part；image/pdf-native 生成对应 part。
 * 文本附件原样给模型（不按 maxCharsPerMessage 裁剪）——见上方数值口径。
 * 调用方负责把结果合并进消息的 ModelPart[]。
 */
export function attachmentsToModelParts(attachments: ChatAttachment[]): ModelPart[] {
  const parts: ModelPart[] = [];
  for (const a of attachments) {
    switch (a.kind) {
      case 'pdf-text': {
        const source = a.sourceUrl ? `\n来源：${a.sourceUrl}` : '';
        parts.push({
          type: 'text',
          text: `[此前读取的 PDF《${a.label}》文字内容]\n${a.text}${source}`,
        });
        break;
      }
      case 'pdf-native':
        parts.push({ type: 'file', uri: a.dataUri, mimeType: a.mimeType, label: a.label });
        break;
      case 'image':
        parts.push({ type: 'image', uri: a.dataUri, mimeType: a.mimeType, label: a.label });
        break;
    }
  }
  return parts;
}
