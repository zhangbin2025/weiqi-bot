/**
 * @fileoverview KataGo Archive 类型定义
 */

/** KataGo 归档日期条目 */
export interface KatagoArchiveEntry {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 下载 URL */
  url: string;
  /** 文件大小（字节） */
  size: number;
}

/** KataGo SGF 条目 */
export interface KatagoSgfEntry {
  /** 文件名 */
  filename: string;
  /** SGF 内容 */
  sgfContent: string;
}
