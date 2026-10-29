/**
 * @fileoverview 拍照摆子服务 —— 从照片还原棋盘黑白空矩阵
 * @module services/photo
 *
 * 用 weiqi-photo（纯前端传统 CV：消失点 + 一维周期估计求四角，圆形度判黑白空）
 * 把一张棋盘照片还原成 N×N 的黑白空矩阵。
 *
 * 两条硬约束（与 OCR 模块同策略）：
 *  1. **照片不出浏览器** —— 全程本地计算，不上传服务器。
 *  2. **opencv.js 不进主 bundle** —— 只有用户点了「拍照摆子」才懒加载。
 *     优先用 public/photo/ 下预置的**预剥离版**（223KB JS + 独立 7.6MB wasm，
 *     走 emscripten 的 instantiateStreaming 流式编译）；该目录由
 *     scripts/build-photo.mjs 生成且不入库，缺失时自动回退 CDN 内嵌版。
 */

import { loadCv, recognizeBoard, type CvLike, type MatLike, type LoadCvOptions, type Quad, type Stone } from '@weiqi/photo';
import { toAbsoluteUrl } from '../../infrastructure/utils/web/pathUtils';

/** 本地 opencv 资源（相对 Web 根，见 toAbsoluteUrl） */
const LOCAL_CV_JS = 'photo/opencv.stripped.js';
const LOCAL_CV_WASM = 'photo/opencv.wasm';

/**
 * 送进识别的图片最长边。
 * 2000 是 weiqi-photo 测试集验证过的取值：再大不会更准，只是更慢
 * （识别是 wasm 同步计算，会冻住主线程，实测约 3s/张）。
 */
const MAX_SIDE = 2000;

/** 记谱页棋盘固定 19 路（presentation 的 BoardSize 只有 9|13|19，且页面无路数选择器） */
export const PHOTO_BOARD_SIZE = 19;

export type PhotoStage = 'loading-cv' | 'recognizing' | 'done' | 'error';

export interface PhotoProgress {
  stage: PhotoStage;
  /** 0~100；未知进度（如纯计算阶段）为 null */
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
  /** 四角检测得分 0~1，越高越可信（供 UI 提示「可能没拍准」） */
  win: number;
  /** 检测到的四角（缩放后图片坐标系），用于在预览图上标注 */
  corners: Quad;
  /** 缩放后的原图 canvas，供 UI 展示给用户对照修正 */
  canvas: HTMLCanvasElement;
  /** 识别耗时（毫秒） */
  elapsedMs: number;
}

/** opencv 实例只加载一次，整个页面生命周期内复用 */
let cvPromise: Promise<CvLike> | null = null;

/** HEAD 探测资源是否存在（决定能不能用本地预剥离版） */
async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 加载图片。
 * ⚠️ 必须 `() => resolve(im)`：直接把 resolve 当 onload 回调时拿到的是 Event，
 *    不是图片对象，后续 naturalWidth 为 undefined → 缩放算出 NaN → canvas 尺寸 0
 *    → drawImage 抛难懂的错。这个坑 weiqi-photo 里踩过一次。
 */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const im = new Image();
  return new Promise<HTMLImageElement>((resolve, reject) => {
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    im.src = url;
  });
}

/** 把图片等比缩到最长边 maxSide，画进离屏 canvas */
function drawToCanvas(im: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const W = im.naturalWidth;
  const H = im.naturalHeight;
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
 * 懒加载 opencv。
 * 幂等：并发调用共用一个 Promise，不会重复下载 10MB。
 */
export function ensureCv(onProgress?: (p: PhotoProgress) => void): Promise<CvLike> {
  if (cvPromise) return cvPromise;
  cvPromise = (async () => {
    const jsUrl = toAbsoluteUrl(LOCAL_CV_JS);
    const wasmUrl = toAbsoluteUrl(LOCAL_CV_WASM);
    const useLocal = await headOk(jsUrl);

    const opt: LoadCvOptions = {
      timeoutMs: 120000,
      onProgress: (p) => {
        if (p.stage === 'fetch-js') {
          const mb = (n: number) => (n / 1048576).toFixed(2);
          onProgress?.({
            stage: 'loading-cv',
            percent: p.total ? Math.round((p.loaded / p.total) * 100) : null,
            message: p.total
              ? `正在下载识别引擎… ${mb(p.loaded)}/${mb(p.total)} MB`
              : `正在下载识别引擎… ${mb(p.loaded)} MB`,
          });
        } else if (p.stage === 'compile') {
          onProgress?.({ stage: 'loading-cv', percent: null, message: '正在初始化识别引擎…' });
        }
      },
    };
    // ⚠️ exactOptionalPropertyTypes 下不能写 url: undefined，必须按需赋值
    if (useLocal) {
      opt.url = jsUrl;
      opt.wasmUrl = wasmUrl;
    }

    const cv = await loadCv(opt);

    // 防御：预剥离版的 wasm 路径若没被替换成我们给的 URL，运行时会去请求
    // 打包时硬编码的旧路径（/dist/opencv.wasm）。站点对未知路径通常回退成
    // 200 + text/html 的首页，浏览器把 HTML 当 wasm 编译，报
    //   expected magic word 00 61 73 6d, found 3c 21 44 4f
    // 这个错因很绕，与其让用户看到，不如在加载成功后立刻自查并说清原因。
    if (useLocal) {
      const g = globalThis as unknown as { wasmBinaryFile?: unknown };
      const actual = typeof g.wasmBinaryFile === 'string' ? g.wasmBinaryFile : '';
      if (actual && actual !== wasmUrl && !actual.startsWith('blob:')) {
        console.warn(
          `[photo] opencv 实际使用的 wasm 路径是 "${actual}"，而非预期的 "${wasmUrl}"。` +
          '请确认 clients/web/public/photo/opencv.stripped.js 里的路径已被 build-photo.mjs 替换为占位符。',
        );
      }
    }

    return cv;
  })().catch((e: unknown) => {
    // 失败后允许下次重试
    cvPromise = null;
    throw e;
  });
  return cvPromise;
}

/**
 * 识别一张棋盘照片。
 *
 * @param file 用户拍照/选图得到的图片
 * @param onProgress 进度回调（识别阶段是同步 wasm 计算，无法报真实进度，
 *                   只能先渲染出提示再开跑，所以这里的 percent 为 null）
 */
export async function recognizePhoto(
  file: Blob,
  onProgress?: (p: PhotoProgress) => void,
): Promise<PhotoBoardResult> {
  const cv = await ensureCv(onProgress);

  const im = await loadImage(file);
  const canvas = drawToCanvas(im, MAX_SIDE);

  onProgress?.({ stage: 'recognizing', percent: null, message: '正在识别棋局…' });
  // 让浏览器把上面这行画出来再进同步计算：识别会冻住主线程约 3 秒，
  // 不 yield 一下用户看到的是「点了没反应」。
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 50)));

  const t0 = performance.now();
  const img: MatLike = cv.imread(canvas);
  try {
    const r = recognizeBoard(cv, img, { size: PHOTO_BOARD_SIZE });
    let black = 0;
    let white = 0;
    for (let k = 0; k < r.stones.length; k++) {
      const v = r.stones[k];
      if (v === 1) black++;
      else if (v === 2) white++;
    }
    const win = typeof r.debug.win === 'number' ? r.debug.win : 0;
    return {
      size: r.N,
      stones: r.stones,
      black,
      white,
      win,
      corners: r.corners,
      canvas,
      elapsedMs: Math.round(performance.now() - t0),
    };
  } finally {
    img.delete();
  }
}
