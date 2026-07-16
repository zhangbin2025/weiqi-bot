/**
 * 终端表格渲染器
 * @description 自动计算列宽、对齐中英文、支持ANSI颜色
 * @module presentation/adapters/cli/TerminalTable
 */
/** 表格列定义 */
export interface TableColumn {
  /** 列标题 */
  header: string;
  /** 列宽度（字符数，中文算2宽度）。不设则自动计算 */
  width?: number;
  /** 对齐方式 */
  align?: 'left' | 'right' | 'center';
  /** 颜色函数（对内容着色） */
  color?: (text: string) => string;
}
/** 表格行数据 */
export type TableRow = string[];
/** 终端表格渲染器 */
export class TerminalTable {
  private columns: TableColumn[];
  private rows: TableRow[] = [];
  constructor(columns: TableColumn[]) {
    this.columns = columns;
  }
  /** 添加行 */
  addRow(row: TableRow): void {
    this.rows.push(row);
  }
  /** 渲染为字符串 */
  render(): string {
    const widths = this.calcWidths();
    const lines: string[] = [];
    // 表头
    const headers = this.columns.map((col, i) => {
      const text = TerminalTable.padDisplay(col.header, widths[i]!, col.align ?? 'left');
      return col.color ? col.color(text) : text;
    });
    lines.push(headers.join('  '));
    // 分隔线
    const seps = this.columns.map((_, i) => '─'.repeat(widths[i]!));
    lines.push(seps.join('  '));
    // 数据行
    for (const row of this.rows) {
      const cells = this.columns.map((col, i) => {
        const raw = row[i] ?? '';
        const text = TerminalTable.padDisplay(raw, widths[i]!, col.align ?? 'left');
        return col.color ? col.color(text) : text;
      });
      lines.push(cells.join('  '));
    }
    return lines.join('\n');
  }
  /** 计算各列宽度 */
  private calcWidths(): number[] {
    return this.columns.map((col, i) => {
      if (col.width) return col.width;
      let max = TerminalTable.displayWidth(col.header);
      for (const row of this.rows) {
        const w = TerminalTable.displayWidth(row[i] ?? '');
        if (w > max) max = w;
      }
      return max;
    });
  }
  /** 计算字符串的终端显示宽度（中文=2，英文=1，ANSI转义=0） */
  static displayWidth(text: string): number {
    // Strip ANSI escape sequences first
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    let width = 0;
    for (const ch of stripped) {
      const code = ch.codePointAt(0)!;
      // CJK Unified Ideographs
      if (code >= 0x4e00 && code <= 0x9fff) { width += 2; continue; }
      // CJK Symbols and Punctuation, Hiragana, Katakana
      if (code >= 0x3000 && code <= 0x30ff) { width += 2; continue; }
      // CJK Compatibility Ideographs
      if (code >= 0xf900 && code <= 0xfaff) { width += 2; continue; }
      // Fullwidth forms
      if (code >= 0xff00 && code <= 0xffef) { width += 2; continue; }
      // CJK Extension A
      if (code >= 0x3400 && code <= 0x4dbf) { width += 2; continue; }
      width += 1;
    }
    return width;
  }
  /** 按显示宽度截断或填充字符串 */
  static padDisplay(text: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
    const dw = TerminalTable.displayWidth(text);
    if (dw >= width) return text;
    const gap = width - dw;
    switch (align) {
      case 'right': return ' '.repeat(gap) + text;
      case 'center': {
        const left = Math.floor(gap / 2);
        const right = gap - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      }
      default: return text + ' '.repeat(gap);
    }
  }
}
