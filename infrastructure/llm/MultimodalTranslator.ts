/**
 * 统一 ModelPart → OpenAI 兼容 content part 的翻译（wire 形状唯一收口）
 * @module infrastructure/llm/MultimodalTranslator
 *
 * 2026-11-13 用户决策：
 * - 图片走标准 `image_url` part，url 取 data URI（base64 内嵌），不传远程 URL（决策 3a）。
 * - 原生 PDF 走 `file` part（OpenAI Chat Completions 的 file_data 形状）。
 * - 端点/模型是否支持某形状是运行时事实：不支持时 400 会被「失败变观察」链路兜住，
 *   不在这里做静态能力探测（凭据在浏览器 localStorage，宿主无从探测）。
 *
 * 换厂商形状只改本文件：application 层只见 ModelPart，不感知任何 wire 细节。
 */

import type { ModelPart } from '../../application/model/IModelGateway';
import type { WireContentPart } from './OpenAICompatibleClient';

/** 从 data URI 拆出 filename 用的展示名兜底 */
function fallbackName(part: ModelPart): string {
  if ('label' in part && part.label) return part.label;
  return part.type === 'file' ? 'document.pdf' : 'image';
}

/**
 * 把统一片段翻译成 wire 片段。
 * - text → {type:'text'}
 * - image → {type:'image_url', image_url:{url:dataUri}}
 * - file(PDF) → {type:'file', file:{file_data:dataUri, filename}}
 * 未知形状（防御未来扩展）降级成一行文本说明，不静默丢内容。
 */
export function modelPartsToWire(parts: ModelPart[]): WireContentPart[] {
  const out: WireContentPart[] = [];
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        out.push({ type: 'text', text: part.text });
        break;
      case 'image':
        out.push({ type: 'image_url', image_url: { url: part.uri } });
        break;
      case 'file':
        out.push({
          type: 'file',
          file: { file_data: part.uri, filename: fallbackName(part) },
        });
        break;
      default: {
        // 穷尽性保护：新增 ModelPart 类型但忘了翻译时，给模型可见的提示
        const kind = (part as { type?: string }).type ?? 'unknown';
        out.push({ type: 'text', text: `[未能发送的多模态片段:${kind}]` });
      }
    }
  }
  return out;
}
