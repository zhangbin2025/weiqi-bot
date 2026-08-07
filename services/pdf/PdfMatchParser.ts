/**
 * PDF 对阵表解析器
 * @description 使用 pdf.js 从 PDF 中提取围棋对阵表数据
 *
 * 使用方式：
 * 1. HTML 中加载 pdf.js CDN：<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
 * 2. 调用 parser.parse(arrayBuffer) 解析一轮对阵
 *
 * 每个 PDF 文件视为一轮对阵。用户可以多次导入不同 PDF，分别对应不同轮次。
 */

import type { PdfMatch, PdfRoundResult } from './types';

/** pdf.js 全局对象声明 */
declare const pdfjsLib: {
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
  Util: { transform(t1: number[], t2: number[]): number[] };
  GlobalWorkerOptions: { workerSrc: string };
};

interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage>; }
interface PdfPage { getViewport(params: { scale: number }): { transform: number[] }; getTextContent(): Promise<TextContent>; }
interface TextContent { items: TextItem[]; }
interface TextItem { str: string; transform: number[]; width: number; height: number; }

interface MappedItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PdfMatchParser {
  /**
   * 解析 PDF 文件，提取一轮对阵数据
   */
  async parse(arrayBuffer: ArrayBuffer): Promise<PdfRoundResult> {
    const warnings: string[] = [];
    const allMatches: PdfMatch[] = [];
    let title: string | undefined;
    let groupName: string | undefined;
    let roundLabel: string | undefined;

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str.trim());
      const vp = page.getViewport({ scale: 1 });

      // 坐标转换
      const mapped: MappedItem[] = items.map(it => {
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        return { str: it.str, x: tx[4] ?? 0, y: tx[5] ?? 0, w: it.width, h: it.height };
      }).sort((a, b) => a.y - b.y || a.x - b.x);

      // 按行分组 + 重建布局文本
      const rows = this.groupByRows(mapped, 2);
      const pageLines = this.buildLayoutText(rows);

      // 提取比赛标题
      if (!title) {
        for (const line of pageLines) {
          const tm = line.match(/\d{4}年.*?(锦标赛|联赛|杯赛|比赛|赛|邀请赛|公开赛)/);
          if (tm) { title = tm[0].trim(); break; }
        }
      }

      // 提取分组名
      if (!groupName) {
        for (const line of pageLines) {
          const gm = line.match(/((?:初中|高中|大学|男子|女子|儿童|少年|青年|成人|老年|公开)[^第]*?组(?:男子|女子|男|女)?)/);
          if (gm) { groupName = gm[1]!.trim(); break; }
        }
      }

      // 提取轮次描述
      if (!roundLabel) {
        for (const line of pageLines) {
          const rm = line.match(/第(\d+)轮/);
          if (rm) { roundLabel = `第${rm[1]!}轮`; break; }
        }
      }

      // 解析对阵
      const pageMatches = this.parseMatchesFromLines(pageLines);
      if (pageMatches.length === 0 && p === 1) {
        warnings.push(`第${p}页未提取到对阵数据`);
      }
      allMatches.push(...pageMatches);
    }

    if (allMatches.length === 0) {
      warnings.push('PDF 中未找到对阵数据');
    }

    const result: PdfRoundResult = { matches: allMatches, warnings };
    if (title) result.title = title;
    if (groupName) result.groupName = groupName;
    if (roundLabel) result.roundLabel = roundLabel;
    return result;
  }

  /** 按行分组（y 坐标容差） */
  private groupByRows(items: MappedItem[], yTol: number): MappedItem[][] {
    if (!items.length) return [];
    const rows: MappedItem[][] = [];
    let cur: MappedItem[] = [items[0]!];
    for (let i = 1; i < items.length; i++) {
      const item = items[i]!;
      if (Math.abs(item.y - cur[0]!.y) < yTol) {
        cur.push(item);
      } else {
        rows.push(cur.sort((a, b) => a.x - b.x));
        cur = [item];
      }
    }
    if (cur.length) rows.push(cur.sort((a, b) => a.x - b.x));
    return rows;
  }

  /** 重建布局文本 */
  private buildLayoutText(rows: MappedItem[][]): string[] {
    return rows.map(row => {
      let ln = '';
      let lastEnd = 0;
      for (const it of row) {
        const cw = it.w / Math.max(1, it.str.length) || 6;
        const gap = Math.round((it.x - lastEnd) / cw);
        if (gap > 1) ln += ' '.repeat(Math.min(gap, 50));
        else if (gap === 1) ln += ' ';
        ln += it.str;
        lastEnd = it.x + it.w;
      }
      return ln;
    });
  }

  /** 从布局文本行解析对阵 */
  private parseMatchesFromLines(lines: string[]): PdfMatch[] {
    const matches: PdfMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/^\s*\d/.test(line)) continue;

      const m = line.match(
        /^\s*(\d+)\s+(\d+)\s+(.*?)\s+(\S{2,4})\s+(\d+)\s*[:：]\s*(\d+)\s+(\S{2,4})\s+(.*?)\s+(\d+)\s*$/
      );
      if (!m) continue;

      const obj: PdfMatch = {
        table: +m[1]!,
        blackNo: +m[2]!,
        blackTeam: this.cls(m[3]!),
        blackName: m[4]!,
        blackScore: +m[5]!,
        whiteName: m[7]!,
        whiteScore: +m[6]!,
        whiteTeam: this.cls(m[8]!),
        whiteNo: +m[9]!,
      };

      // 检查续行
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!;
        const nx = nextLine.trim();
        if (nx && !/^\d/.test(nx) && !/[:：]/.test(nx)) {
          const lead = nextLine.length - nextLine.trimStart().length;
          if (lead < 25) {
            obj.blackTeam = (obj.blackTeam ?? '') + this.cls(nx);
          } else {
            obj.whiteTeam = (obj.whiteTeam ?? '') + this.cls(nx);
          }
        }
      }

      matches.push(obj);
    }

    return matches;
  }

  private cls(s: string): string {
    return s.replace(/[\s　]+/g, '');
  }
}
