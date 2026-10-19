/**
 * OCR 对阵表识别模块
 * @module services/ocr
 *
 * 纯前端方案：图片不出浏览器，全程本地推理。
 * 引擎为 PaddleOCR 官方 @paddleocr/paddleocr-js（PP-OCRv5 mobile，准确优先）。
 */

export { PaddleOcrJsEngine } from './PaddleOcrJsEngine';
export { parseOcrResult } from './OcrMatchParser';
export type { OcrRoundResult } from './OcrMatchParser';
export { buildTable, clusterRows, detectColumns, cellText, rowTexts, inferRowTolerance } from './TableBuilder';
export { assignColumnRoles, pickColumn } from './ColumnRoles';
export type { ColumnRole, ColumnAssignment, Side } from './ColumnRoles';
export type {
  OcrItem,
  OcrBackend,
  OcrProgress,
  OcrProgressStage,
  OcrRecognizeMeta,
  IOcrEngine,
  TableGrid,
  TableCell,
  ColumnRange,
} from './types';
