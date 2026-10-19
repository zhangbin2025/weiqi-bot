/**
 * OCR 模块类型定义
 * @module services/ocr/types
 *
 * 本模块只依赖原生 TS，不引入任何 OCR 引擎类型，
 * 便于表格重建逻辑在 Node（vitest）中直接单测。
 */

/** OCR 识别出的单个文本块 */
export interface OcrItem {
  /** 识别文本 */
  text: string;
  /** 置信度 0~1 */
  score: number;
  /** 外接框左上角 x（原始图片坐标系） */
  x: number;
  /** 外接框左上角 y（原始图片坐标系） */
  y: number;
  /** 外接框宽度 */
  w: number;
  /** 外接框高度 */
  h: number;
}

/** 列区间（左闭右开） */
export interface ColumnRange {
  /** 列序号，0 起 */
  index: number;
  /** 起始 x（含） */
  start: number;
  /** 结束 x（不含） */
  end: number;
}

/** 重建后的表格单元格 */
export interface TableCell {
  /** 所属行号，0 起 */
  row: number;
  /** 所属列号，0 起 */
  col: number;
  /** 单元格文本（同列多个块时按置信度取最优） */
  text: string;
  /** 该文本对应的置信度 */
  score: number;
}

/** 重建后的表格网格 */
export interface TableGrid {
  /** 所有单元格，按 row、col 升序 */
  cells: TableCell[];
  /** 行数 */
  rowCount: number;
  /** 列数 */
  columnCount: number;
  /** 用到的列区间 */
  columns: ColumnRange[];
}

/** 后端类型 */
export type OcrBackend = 'webgpu' | 'wasm';

/** 引擎初始化进度阶段 */
export type OcrProgressStage = 'loading' | 'initializing' | 'recognizing';

/** 下载阶段的细分，用于给出真实字节进度 */
export type OcrDownloadKind = 'bundle' | 'worker' | 'ort' | 'model';

export interface OcrProgress {
  stage: OcrProgressStage;
  /** 0~100，无法估算时传 null */
  percent: number | null;
  message: string;
  /**
   * 阶段内的真实字节进度（实测所有下载都有 Content-Length，可精确计算）。
   * 有值时应优先于 percent 展示，避免"假进度"。
   */
  bytes?: {
    /** 已下载字节 */
    loaded: number;
    /** 总字节；未知时为 0 */
    total: number;
  };
  /** 下载阶段的具体资源类型 */
  kind?: OcrDownloadKind;
}

/** 识别结果元信息 */
export interface OcrRecognizeMeta {
  /** 实际使用的后端 */
  backend: OcrBackend;
  /** WebGPU 是否可用 */
  webgpuAvailable: boolean;
  /**
   * 当前是否为软件渲染（无真实 GPU）
   *
   * 为真时 WebGPU 是 CPU 模拟，实测比 WASM 慢 35 倍，故会强制走 WASM。
   * UI 可据此提示用户「未检测到 GPU，使用 CPU 推理」。
   */
  softwareRenderer?: boolean;
  /** 检测模型 provider */
  detProvider: string;
  /** 识别模型 provider */
  recProvider: string;
  /** 引擎初始化耗时 ms */
  initMs: number;
  /** 推理耗时 ms */
  inferMs: number;
  /** 图片宽度 */
  imageWidth: number;
  /** 图片高度 */
  imageHeight: number;
}

/** OCR 引擎接口 */
export interface IOcrEngine {
  /** 实际生效的后端（init 之后才有意义） */
  readonly backend: OcrBackend;
  /** WebGPU 是否可用（init 之后才有意义） */
  readonly webgpuAvailable: boolean;
  /** 是否已初始化 */
  readonly ready: boolean;
  /** 初始化（下载模型 + 建 session），可重复调用，幂等 */
  init(onProgress?: (p: OcrProgress) => void): Promise<void>;
  /** 识别图片 */
  recognize(source: Blob | File, onProgress?: (p: OcrProgress) => void): Promise<{ items: OcrItem[]; meta: OcrRecognizeMeta }>;
  /** 释放资源 */
  dispose(): Promise<void>;
}
