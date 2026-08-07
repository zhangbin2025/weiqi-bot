/**
 * PDF 对阵表解析类型定义
 */

/** PDF 解析出的单场对阵 */
export interface PdfMatch {
  /** 台号 */
  table: number;
  /** 黑方编号（可选） */
  blackNo?: number;
  /** 黑方姓名 */
  blackName: string;
  /** 黑方单位（可选） */
  blackTeam?: string;
  /** 黑方得分 */
  blackScore: number;
  /** 白方姓名 */
  whiteName: string;
  /** 白方编号（可选） */
  whiteNo?: number;
  /** 白方单位（可选） */
  whiteTeam?: string;
  /** 白方得分 */
  whiteScore: number;
}

/** 单轮 PDF 解析结果 */
export interface PdfRoundResult {
  /** 比赛名称（可选，从PDF中提取） */
  title?: string;
  /** 分组名称（可选） */
  groupName?: string;
  /** 轮次描述（如"第1轮"） */
  roundLabel?: string;
  /** 该轮所有对阵 */
  matches: PdfMatch[];
  /** 解析警告 */
  warnings: string[];
}
