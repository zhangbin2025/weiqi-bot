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
 *
 * 识别分两步（先框再识）：
 *   1. `loadPhotoCanvas` —— 纯 2D，只解码 + 缩放到 2000px，不碰 opencv，秒开，
 *      给裁剪 UI 用。用户可能框完就取消，不该为此下 10MB。
 *   2. `recognizeRegion` —— 点「确认」后才懒加载 opencv，按框裁剪再识别。
 *
 * 为什么要框：整图识别时粗定位会把桌面纹理/书本边/棋盒一起并进凸包，四角外扩，
 * 后面的消失点与周期估计全跟着歪，这是边界识别不准的主因。
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

/**
 * 裁剪框（缩放后图片坐标系，像素，左上角 + 宽高）。
 *
 * 为什么要裁剪：整图识别时粗定位（黑帽 + 连通域 + 凸包 + 最大四边形）会把桌面
 * 纹理、书本边、棋盒一起并进凸包，四角外扩，后面消失点/周期估计全跟着歪。
 * 用户手动框住棋盘后，画面里只剩棋盘 + 少量背景，粗定位基本不会跑偏。
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 裁剪后最短边下限（像素）。
 *
 * 再小的话 `small()` 把图缩到 1000px 后每格只剩几个像素，周期估计必崩
 * （表现为四角乱飞或直接抛 noboard）。由裁剪 UI 用来禁用「确认」。
 */
export const MIN_CROP_SIDE = 300;

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
  /** 检测到的四角（未裁剪原图坐标系，已加回裁剪偏移），用于在预览图上标注 */
  corners: Quad;
  /**
   * 实际送进识别的那张图 —— 即按 region 裁剪后的 canvas。
   *
   * 给 UI 做对照缩略图用：用户看到的就是算法看到的，两者不会有偏差。
   * 相应地，corners 就是这张裁剪图的坐标系，不需要再加 region 偏移。
   */
  canvas: HTMLCanvasElement;
  /** 本次裁剪在原图上的位置（原图坐标系）；canvas 就是这个范围的切片 */
  region: CropRect;
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
 * 只把图片解码 + 缩放成 canvas，不碰 opencv。
 *
 * 裁剪 UI 要先出图才能让用户框选，此时不该触发 10MB opencv 下载 —— 用户可能
 * 只是想看看照片拍糊没有，框完取消掉。opencv 留到真正点「确认」时再加载。
 */
export async function loadPhotoCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const im = await loadImage(file);
  return drawToCanvas(im, MAX_SIDE);
}

/**
 * 把裁剪框钳到画布范围内并取整。
 *
 * UI 拖出来的是 CSS 像素浮点，乘上缩放比再取整后可能越界一两个像素，
 * drawImage 越界不报错（补透明），但会让四角偏移算错，所以在这里兜住。
 */
function clampRect(r: CropRect, w: number, h: number): CropRect {
  const x = Math.max(0, Math.min(Math.round(r.x), Math.max(0, w - 1)));
  const y = Math.max(0, Math.min(Math.round(r.y), Math.max(0, h - 1)));
  const rw = Math.max(1, Math.min(Math.round(r.w), w - x));
  const rh = Math.max(1, Math.min(Math.round(r.h), h - y));
  return { x, y, w: rw, h: rh };
}

/**
 * 识别 canvas 上指定矩形范围内的棋盘。
 *
 * 裁剪在这里完成：把框内的像素画到离屏 canvas，再交给 recognizeBoard。
 * 库侧拿到的就是一张「棋盘占满画面」的图，粗定位不会被桌面对比度带偏。
 *
 * @param canvas loadPhotoCanvas() 得到的整图
 * @param region 裁剪框（canvas 像素坐标系）
 * @param onProgress 进度回调
 */
export async function recognizeRegion(
  canvas: HTMLCanvasElement,
  region: CropRect,
  onProgress?: (p: PhotoProgress) => void,
): Promise<PhotoBoardResult> {
  const rect = clampRect(region, canvas.width, canvas.height);
  if (Math.min(rect.w, rect.h) < MIN_CROP_SIDE) {
    throw new Error(`框选范围太小（${rect.w}×${rect.h}），请把整个棋盘框进来`);
  }

  const cv = await ensureCv(onProgress);

  const crop = document.createElement('canvas');
  crop.width = rect.w;
  crop.height = rect.h;
  const cctx = crop.getContext('2d');
  if (!cctx) throw new Error('无法创建 canvas 上下文');
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  onProgress?.({ stage: 'recognizing', percent: null, message: '正在识别棋局…' });
  // 让浏览器把上面这行画出来再进同步计算：识别会冻住主线程约 3 秒，
  // 不 yield 一下用户看到的是「点了没反应」。
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 50)));

  const t0 = performance.now();
  const img: MatLike = cv.imread(crop);
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
    // 四角就是裁剪图坐标系 —— result.canvas 也是这张裁剪图，两者一致，
    // 缩略图上直接画即可。（早期版本返回整图 + 加偏移，导致「看到的」和
    // 「识别的」不是同一张，对照时无法判断到底是框错了还是判错了。）
    return {
      size: r.N,
      stones: r.stones,
      black,
      white,
      win,
      corners: r.corners,
      canvas: crop,
      region: rect,
      elapsedMs: Math.round(performance.now() - t0),
    };
  } finally {
    img.delete();
  }
}

/**
 * 识别整张照片（不裁剪）。
 *
 * 保留给不需要裁剪的调用方；记谱页的「拍照摆子」走 loadPhotoCanvas +
 * recognizeRegion 两步，先框再识别。
 */
export async function recognizePhoto(
  file: Blob,
  onProgress?: (p: PhotoProgress) => void,
): Promise<PhotoBoardResult> {
  const canvas = await loadPhotoCanvas(file);
  return recognizeRegion(canvas, { x: 0, y: 0, w: canvas.width, h: canvas.height }, onProgress);
}
