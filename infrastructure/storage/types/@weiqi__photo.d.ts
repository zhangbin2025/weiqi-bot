/**
 * @weiqi/photo 类型声明（新 main 分支 / Plan C 库依赖方式）
 *
 * 实际实现是 weiqi-photo 的原生 ES modules，由 Vite alias
 *   '@weiqi/photo' → ../weiqi-photo/inference/src/index.mjs
 * 在构建时解析（与 @weiqi/worker 一致）。weiqi-photo 不再是 npm 包、
 * 不进 package.json 依赖、不需要 file: 链接。
 *
 * 这里只声明 weiqi-bot 实际会用到的接口；底层几何/推理符号由 index.mjs
 * re-export，需要时在下方补 declare 即可（保持与 index.mjs 的 export 列表同步）。
 */

declare module '@weiqi/photo' {
  /** RGBA 光栅图，形如 canvas.getContext('2d').getImageData() 的返回。 */
  export interface PhotoImageData {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
  }

  /** 可下子网格的一个角点，单位=原图像素坐标。 */
  export interface QuadPoint {
    x: number;
    y: number;
  }

  /** 四角顺序：[左上, 右上, 右下, 左下]（cyclic）。 */
  export type Quad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint];

  /** 0=空 / 1=黑 / 2=白，与 weiqi-bot result.stones[] 编码一致。 */
  export type Stone = 0 | 1 | 2;

  export interface TranscribeDiagnostics {
    occupied: number;
    meanConfidence: number;
    cell: number;
    patchSize: number;
    method: 'cnn';
  }

  export interface TranscribeResult {
    ok: boolean;
    /** 棋盘路数（9 / 13 / 19）。 */
    size: number;
    /** lines*lines 扁平数组，行优先。 */
    stones: Stone[];
    /** 同 stones 的 Int8Array 形态。 */
    M: Int8Array;
    /** 每个交叉点的置信度。 */
    C: Float32Array;
    quality: number;
    diagnostics: TranscribeDiagnostics;
  }

  /**
   * 高阶入口：四角 → 透视校正 → 交叉点 → CNN 识别。
   * @param imageData 原图 RGBA 光栅（可用 decodeFile(file).decoded）
   * @param quad      四角 [TL,TR,BR,BL]，原图像素坐标
   * @param lines     路数
   * @param onnxModel cnn.onnx 的字节（运行时从 photo/cnn.onnx fetch）
   */
  export function transcribe(
    imageData: PhotoImageData,
    quad: Quad,
    lines: number,
    onnxModel: Uint8Array,
  ): Promise<TranscribeResult>;

  /** 把浏览器 File 解码成 { bytes, decoded: PhotoImageData }。 */
  export function decodeFile(file: File): Promise<{ bytes: Uint8Array; decoded: PhotoImageData }>;
}
