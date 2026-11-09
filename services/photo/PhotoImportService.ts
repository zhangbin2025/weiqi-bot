/**
 * @fileoverview 拍照摆子服务 —— 从照片还原棋盘黑白空矩阵
 * @module services/photo
 *
 * 用 weiqi-photo（Plan C：CNN + ONNX Runtime Web）把一张棋盘照片
 * 还原成 N×N 的黑白空矩阵。
 *
 * 硬约束（与 OCR 模块同策略）：
 *  1. **照片不出浏览器** —— 全程本地计算，不上传服务器。
 *  2. **ORT 走 CDN** —— onnxruntime-web 从 jsDelivr 加载，不随包分发。
 *  3. **cnn.onnx 走本地** —— 模型字节由 build-photo.mjs 拷进 public/photo/，
 *     运行时 fetch 一次传给 transcribe()，只在点「确认」时才加载。
 *
 * 识别分两步（先框再识）：
 *   1. `loadPhotoCanvas` —— 纯 2D，只解码 + 缩放到 2000px，不碰 ORT，秒开，
 *      给裁剪 UI 用。用户可能框完就取消，不该为此下模型。
 *   2. `recognizeRegion` —— 点「确认」后才 fetch onnx + 调 transcribe。
 *
 * 为什么要框：整图识别时棋盘外的纹理会被框进来干扰识别。
 * 用户手动框住棋盘（点四角），画面里只剩棋盘 + 少量背景。
 */

import { transcribe, type Quad, type Stone } from '@weiqi/photo';
import { toAbsoluteUrl } from '../../infrastructure/utils/web/pathUtils';

/** 本地 onnx 模型路径（相对 Web 根） */
const ONNX_URL = 'photo/cnn.onnx';

/** 送进识别的图片最长边。 */
const MAX_SIDE = 2000;

/** 记谱页棋盘固定 19 路 */
export const PHOTO_BOARD_SIZE = 19;

/**
 * 四角顺序：[TL, TR, BR, BL]（左上、右上、右下、左下），cyclic。
 * 与 weiqi-photo `unitFromQuad` 的契约一致。
 */
export type CropRect = Quad; // 别名：历史代码用 CropRect 命名，保持兼容

/** 裁剪后最短边下限（像素）。 */
export const MIN_CROP_SIDE = 300;

export type PhotoStage = 'loading-cv' | 'recognizing' | 'done' | 'error';

export interface PhotoProgress {
  stage: PhotoStage;
  percent: number | null;
  message: string;
}

export interface PhotoBoardResult {
  /** 路数（恒为 PHOTO_BOARD_SIZE） */
  size: number;
  /** 行主序矩阵，长度 N*N，索引 j*N+i；0 空 / 1 黑 / 2 白 */
  stones: Stone[];
  /** 黑子数 */
  black: number;
  /** 白子数 */
  white: number;
  /** 置信度 0~1 */
  quality: number;
  /** 四角（canvas 像素坐标系），用于缩略图标注 */
  corners: Quad;
  /** 实际送进识别的 canvas */
  canvas: HTMLCanvasElement;
  /** 识别耗时（毫秒） */
  elapsedMs: number;
}

/** onnx 模型字节只 fetch 一次，整个页面生命周期内复用 */
let onnxPromise: Promise<Uint8Array> | null = null;

/** HEAD 探测资源是否存在 */
async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 懒加载 cnn.onnx 模型字节。
 * 幂等：并发调用共用一个 Promise。
 */
export function ensureOnnxModel(onProgress?: (p: PhotoProgress) => void): Promise<Uint8Array> {
  if (onnxPromise) return onnxPromise;
  onnxPromise = (async () => {
    const url = toAbsoluteUrl(ONNX_URL);
    if (!(await headOk(url))) {
      throw new Error(
        '识别模型不存在，请先运行 node scripts/build-photo.mjs（或按 weiqi-photo/TRAINING.md 训练生成 cnn.onnx）',
      );
    }
    onProgress?.({ stage: 'loading-cv', percent: null, message: '正在加载识别模型…' });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`模型下载失败: HTTP ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    onProgress?.({ stage: 'loading-cv', percent: 100, message: '模型已就绪' });
    return buf;
  })().catch((e: unknown) => {
    onnxPromise = null;
    throw e;
  });
  return onnxPromise;
}

/** 加载图片。使用 createImageBitmap 保持与 demo 一致的解码路径。 */
function loadImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** 把图片等比缩到最长边 maxSide，画进离屏 canvas */
function drawToCanvas(im: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const W = im.width;
  const H = im.height;
  if (!W || !H) throw new Error(`图片尺寸为 0（未加载成功？）${W}x${H}`);
  const s = Math.min(1, maxSide / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * s);
  c.height = Math.round(H * s);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, 0, 0, c.width, c.height);
  return c;
}

/**
 * 只把图片解码 + 缩放成 canvas，不碰模型。
 * 裁剪 UI 要先出图，此时不该触发模型下载。
 */
export async function loadPhotoCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const im = await loadImage(file);
  return drawToCanvas(im, MAX_SIDE);
}

/**
 * 识别 canvas 上指定四角范围内的棋盘。
 *
 * @param canvas loadPhotoCanvas() 得到的整图
 * @param quad   四角 [TL,TR,BR,BL]（canvas 像素坐标系）
 * @param onProgress 进度回调
 */
export async function recognizeRegion(
  canvas: HTMLCanvasElement,
  quad: Quad,
  onProgress?: (p: PhotoProgress) => void,
): Promise<PhotoBoardResult> {
  // 基本校验：四角不能全挤在一起
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (Math.min(w, h) < MIN_CROP_SIDE) {
    throw new Error(`框选范围太小（${Math.round(w)}×${Math.round(h)}），请把整个棋盘框进来`);
  }

  const onnxModel = await ensureOnnxModel(onProgress);

  // 直接从 canvas 取 imageData
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = { data: imgData.data, width: imgData.width, height: imgData.height };

  onProgress?.({ stage: 'recognizing', percent: null, message: '正在识别棋局…' });
  // 让浏览器画出进度再进同步计算
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 50)));

  const t0 = performance.now();
  const r = await transcribe(imageData, quad, PHOTO_BOARD_SIZE, onnxModel);


  if (!r.ok) {
    throw new Error('识别失败，请重新框选或重拍');
  }

  let black = 0;
  let white = 0;
  for (let k = 0; k < r.stones.length; k++) {
    const v = r.stones[k];
    if (v === 1) black++;
    else if (v === 2) white++;
  }

  return {
    size: r.size,
    stones: r.stones,
    black,
    white,
    quality: r.quality,
    corners: quad,
    canvas,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

/**
 * 识别整张照片（不框选）。
 * 保留给不需要裁剪的调用方。
 */
export async function recognizePhoto(
  file: Blob,
  onProgress?: (p: PhotoProgress) => void,
): Promise<PhotoBoardResult> {
  const canvas = await loadPhotoCanvas(file);
  // 整图四角
  const quad: Quad = [
    { x: 0, y: 0 },
    { x: canvas.width, y: 0 },
    { x: canvas.width, y: canvas.height },
    { x: 0, y: canvas.height },
  ];
  return recognizeRegion(canvas, quad, onProgress);
}