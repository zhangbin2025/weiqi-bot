/**
 * PDF 端侧抽文本（pdf.js 全局版）
 * @module application/chat/PdfTextExtractor
 *
 * 与 event 页同一加载方式：cdnjs 的 pdf.min.js + pdf.worker.min.js，
 * 通过全局 pdfjsLib 使用（见 clients/web/assistant/chat.html）。不复用
 * services/pdf/PdfMatchParser.ts —— 那是对阵表业务解析器，带布局/正则规则。
 *
 * 边界（如实说明，不假装读过）：
 * - 只抽文字层：扫描版 PDF（纯图）、版式复杂的多栏/表格会丢内容或顺序。
 * - 抽不出文字时返回空文本，由调用方决定降级到原生 PDF 或明确告知模型。
 * - 页数与字符都不设新阈值：整份抽完，观察文本由 WebToolLoop 沿用
 *   CONTEXT_LIMITS 裁剪（同一套口径，不新增常数）。
 */

/** 与 event 页一致的全局 pdf.js 形状（只用得到这三个成员） */
interface PdfJsGlobal {
  getDocument(params: { data: Uint8Array }): { promise: Promise<PdfDocumentLike> };
  GlobalWorkerOptions: { workerSrc: string };
}
interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }>;
  destroy(): Promise<void>;
}

function pdfjs(): PdfJsGlobal {
  const global = globalThis as unknown as { pdfjsLib?: PdfJsGlobal };
  if (!global.pdfjsLib) {
    throw new Error('pdf.js 未加载（请检查 cdnjs 脚本是否可用）');
  }
  return global.pdfjsLib;
}

export interface PdfTextResult {
  text: string;
  pages: number;
  /** 是否整份都没抽到文字（扫描件/纯图）——调用方据此决定是否降级 */
  empty: boolean;
}

/**
 * 逐页抽文本，页间用空行分隔。pdf.js 的 getTextContent().items 顺序即阅读顺序，
 * 不做坐标重建（那是 PdfMatchParser 的业务逻辑，通用抽取不假设版式）。
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  const lib = pdfjs();
  // pdf.js 3.x 接受 Uint8Array；传副本避免库内部 transfer/detach 影响调用方
  const data = new Uint8Array(bytes);
  const pdf = await lib.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const line = content.items
        .map((it) => (typeof it.str === 'string' ? it.str : ''))
        .filter((s) => s.trim())
        .join(' ')
        .trim();
      if (line) pages.push(`[第 ${p} 页]\n${line}`);
    }
    const text = pages.join('\n\n');
    return { text, pages: pdf.numPages, empty: text.length === 0 };
  } finally {
    try { await pdf.destroy(); } catch { /* 释放失败不影响已抽出的文本 */ }
  }
}
