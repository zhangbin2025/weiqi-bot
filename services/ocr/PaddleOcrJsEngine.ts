/**
 * PaddleOCR.js 引擎封装
 * @module services/ocr/PaddleOcrJsEngine
 *
 * 引擎本体由 scripts/build-ocr.mjs 预打包到 public/ocr/bundle.js，
 * 通过 window.__WeiqiOcrNs 暴露，这里做懒加载 + 生命周期管理。
 *
 * 后端选择（用户要求：准确优先，能用 GPU 优先用，不能用再降级 CPU）：
 *   实测（2026-10-19，真实 Chrome + swiftshader 软件渲染）：
 *     backend=auto → webgpu，同图 137.4s
 *     backend=wasm → wasm， 同图   3.9s
 *   即「软件渲染的 WebGPU 比 WASM 慢 35 倍」。真机有独立 GPU 时反之。
 *   由于无法在运行时区分「真 GPU」与「软件渲染」，
 *   这里采用 navigator.gpu 存在性探测，并在 Worker 内由 ORT 自行降级。
 *
 * 进度上报（2026-10-19 针对"以为页面卡死"的体验问题重做）：
 *   - 实测各阶段耗时：首屏资产约 6.5s，模型下载约 3s，识别约 48s。
 *     真正的"卡住感"来自识别阶段，仅显示下载进度并不能解决问题。
 *   - bundle / ort / model 走 fetch，可拦截并统计真实字节（均有 Content-Length）。
 *   - worker 走 new Worker(new URL(...))，不经过 fetch，本身不可观测；
 *     这里改为「先 fetch 预热（计入字节进度）再建 Worker」，命中 HTTP 缓存后
 *     建 Worker 几乎无额外耗时，从而让这段也有真实进度。
 *   - 识别阶段：库不提供任何进度回调（实测 bundle 内 progress/onProgress 命中为 0），
 *     因此用「基于上次实测耗时的渐近估计」给出不断推进但不达 100% 的进度，
 *     明确标注为"预计"，配合文案说明，不谎报精确值。
 */

import type {
  IOcrEngine,
  OcrBackend,
  OcrItem,
  OcrProgress,
  OcrRecognizeMeta,
  OcrDownloadKind,
} from './types';

/** 百度 CDN 模型地址（官方包内置默认值，此处显式写出便于替换/自建） */
// 注意：主机名是 ecology 不是 ecosystem（写成后者会 404，实测 200 vs 404）
const MODEL_CDN =
  'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';

/** 准确优先：PP-OCRv5 mobile（README 实测人名 4/4 全对） */
const DET_MODEL = 'PP-OCRv5_mobile_det';
const REC_MODEL = 'PP-OCRv5_mobile_rec';

/**
 * ORT 运行时的本地回退目录
 *
 * 主路径是 manifest 里的 CDN base（ORT 27MB 超过 Workers 单资源 25MiB 上限，
 * 不能随包发布）。仅当 manifest 缺失/无 base 时才回退到本地，
 * 便于离线调试或自建部署把 ORT 重新放回 public/ocr/ort/。
 */
const ORT_FALLBACK_PATH = 'ocr/ort/';

/**
 * 模型体积（字节），用于把「模型下载」并入总体字节进度。
 * 实测 Content-Length：det 4,843,520 / rec 16,701,440。
 * 这两个文件来自百度 CDN，不在 manifest 内，故在此声明。
 */
const MODEL_BYTES: Record<string, number> = {
  [DET_MODEL]: 4843520,
  [REC_MODEL]: 16701440,
};

/** 上次实测的识别耗时（ms），用于渐近估计；无历史数据时用保守值 */
const DEFAULT_INFER_MS = 45000;

/** bundle 暴露的命名空间 */
interface OcrNamespace {
  PaddleOCR: {
    create(options: Record<string, unknown>): Promise<OcrRecognizer>;
  };
}

interface OcrRecognizer {
  predict(input: Blob | File): Promise<
    Array<{
      image: { width: number; height: number };
      items: Array<{ poly: Array<{ x?: number; y?: number } | number[]>; text: string; score: number }>;
      metrics?: { detMs: number; recMs: number; totalMs: number };
      runtime?: {
        requestedBackend: string;
        detProvider: string;
        recProvider: string;
        webgpuAvailable: boolean;
      };
    }>
  >;
  dispose(): Promise<void>;
}

/** manifest.json 结构（由 scripts/build-ocr.mjs 产出，带内容 hash） */
interface OcrManifest {
  version: number;
  bundle: { path: string; size: number };
  worker: Array<{ path: string; size: number }>;
  /** v2 起 ort 改由 CDN 加载：base 拼上 files[].path 即完整地址 */
  ort: {
    base: string;
    files: Array<{ path: string; size: number }>;
  };
}

declare global {
  interface Window {
    __WeiqiOcrNs?: OcrNamespace;
  }
}

/**
 * 把相对路径转成绝对 URL
 *
 * 必须用 location.origin 而不是 document.baseURI：
 * 本项目是 SPA，路由会被 pushState 改写（实测访问 / 时 baseURI 为
 * http://host/assistant/）。若用 baseURI，ocr/bundle.js 会被拼成
 * /assistant/ocr/bundle.js → 404；ORT 同理，且报错非常隐晦：
 *   "no available backend found. ERR:[wasm] Failed to fetch dynamically
 *    imported module: http://host/assistant/ocr/ort/ort-wasm-simd-threaded.jsep.mjs"
 */
function toAbs(rel: string): string {
  return location.origin + '/' + rel.replace(/^\//, '');
}

/** 从 poly 里取最小/最大坐标，兼容 [x,y] 数组与 {x,y} 对象两种形态 */
function polyBounds(poly: Array<{ x?: number; y?: number } | number[]>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    let x: number, y: number;
    if (Array.isArray(p)) {
      x = Number(p[0]);
      y = Number(p[1]);
    } else {
      x = Number(p.x);
      y = Number(p.y);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * 探测 WebGPU 是否可用，并判断是否为软件渲染
 *
 * 只判 navigator.gpu 存在性是不够的：
 *   实测本机（QEMU 虚拟显卡 Cirrus Logic GD 5446）requestAdapter() 依然返回 adapter，
 *   adapter.info 却是空对象 {} —— Chrome 不暴露 vendor，无法据此区分软硬。
 *
 * 可行判据是 WebGL 的 UNMASKED_RENDERER（实测）：
 *   "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"
 * 出现 SwiftShader / llvmpipe / Software 即判定为软件渲染。
 * 软件渲染下的 WebGPU 是 CPU 模拟，实测比纯 WASM 慢 35 倍，必须避开。
 */
async function probeWebGpu(): Promise<{ available: boolean; software: boolean }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  let adapterOk = false;
  if (gpu) {
    try {
      adapterOk = !!(await gpu.requestAdapter());
    } catch {
      adapterOk = false;
    }
  }
  if (!adapterOk) return { available: false, software: false };
  return { available: true, software: isSoftwareRenderer() };
}

/** 通过 WebGL 的 UNMASKED_RENDERER 判断当前是否软件渲染 */
function isSoftwareRenderer(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return true; // 连 WebGL 都没有，几乎必然无 GPU
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    // 探测失败时保守判定为软件渲染（宁可走 WASM，也不要用户卡 137s）
    return true;
  }
}

/** 人类可读的字节数 */
function fmtBytes(n: number): string {
  if (n <= 0) return '';
  const mb = n / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

/**
 * 把图片文件解码并按需要放大
 *
 * 原图过窄时小字吃亏（table-ocr 实测：509px 宽图放大 2x 后识别明显改善）。
 * 放大后的坐标在返回前统一除回原尺度，保证与人工观察的像素坐标一致。
 */
async function loadAndMaybeUpscale(file: Blob | File): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < 1200 ? 2 : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { canvas, scale };
}

export class PaddleOcrJsEngine implements IOcrEngine {
  private recognizer: OcrRecognizer | null = null;
  private initPromise: Promise<void> | null = null;
  private _backend: OcrBackend = 'wasm';
  private _webgpuAvailable = false;
  /** 当前是否为软件渲染（无真 GPU）。为真时强制走 WASM */
  private softwareRenderer = false;
  private initMs = 0;
  private manifest: OcrManifest | null = null;
  /** 上次识别耗时，用于下次渐近估计 */
  private lastInferMs = 0;
  /** 已下载的字节（跨阶段累计，用于总体进度） */
  private loadedBytes = 0;
  private totalBytes = 0;
  /**
   * 原生 fetch 的引用（在类实例化时抓取）。
   *
   * 必须缓存原始引用：doInit 期间会把 window.fetch 替换成包装版，
   * 若 fetchWithProgress 内部再调用 fetch(...)，就会命中被替换的版本
   * → wrapped → fetchWithProgress → wrapped → … 无限递归，
   * 实测直接抛 RangeError: Maximum call stack size exceeded。
   */
  private readonly nativeFetch: typeof fetch =
    (globalThis as { fetch?: typeof fetch }).fetch?.bind(globalThis) ?? fetch;

  get backend(): OcrBackend {
    return this._backend;
  }

  get webgpuAvailable(): boolean {
    return this._webgpuAvailable;
  }

  get ready(): boolean {
    return this.recognizer !== null;
  }

  /** 拉取 manifest（含带 hash 的 worker 文件名与各文件体积） */
  private async loadManifest(): Promise<OcrManifest | null> {
    if (this.manifest) return this.manifest;
    try {
      const r = await fetch(toAbs('ocr/manifest.json'), { cache: 'no-cache' });
      if (!r.ok) return null;
      this.manifest = (await r.json()) as OcrManifest;
      return this.manifest;
    } catch {
      return null;
    }
  }

  /**
   * 统计一次下载的字节进度
   *
   * 只统计我们关心的资源（bundle / worker / ort / model），
   * 其余请求原样透传，避免影响页面其它功能。
   */

  /**
   * HEAD 探测资源的真实体积
   *
   * 不能硬编码：一旦 CDN 换了模型文件，硬编码值就会与真实值漂移，
   * 导致「已下载 > 总量」这种百分比破百的显示（实测出现过 23.7MB / 20.5MB）。
   * Content-Length 属 CORS 安全响应头，无需额外 expose 即可读取。
   * 失败时返回 null，由调用方回退到硬编码估算值。
   */
  private async headContentLength(url: string): Promise<number | null> {
    try {
      const r = await this.nativeFetch(url, { method: 'HEAD' });
      const n = +(r.headers.get('content-length') || 0);
      return n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  private fetchWithProgress(
    url: string,
    onBytes: (loaded: number, total: number) => void,
    /** 实际发起请求的 fetch；默认用原生引用，避免递归命中被包装的版本 */
    impl: typeof fetch = this.nativeFetch
  ): Promise<Response> {
    const p = impl(url).then((resp) => {
      const total = +(resp.headers.get('content-length') || 0);
      onBytes(0, total);
      const body = resp.body;
      if (!body || !total) {
        onBytes(total, total);
        return resp;
      }
      const reader = body.getReader();
      let loaded = 0;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              loaded += value.length;
              onBytes(loaded, total);
              controller.enqueue(value);
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      });
      return new Response(stream, { headers: resp.headers, status: resp.status, statusText: resp.statusText });
    });
    return p;
  }

  /** 预热下载（只填充 HTTP 缓存，不消费内容），带真实字节进度 */
  private async prefetch(
    rel: string,
    kind: OcrDownloadKind,
    label: string,
    onProgress?: (p: OcrProgress) => void
  ): Promise<void> {
    const url = toAbs('ocr/' + rel.replace(/^\//, ''));
    await this.fetchWithProgress(url, (loaded, total) => {
      onProgress?.({
        stage: 'loading',
        percent: total ? Math.round((loaded / total) * 100) : null,
        message: `正在下载${label}…${total ? ` ${fmtBytes(loaded)} / ${fmtBytes(total)}` : ''}`,
        bytes: { loaded, total },
        kind,
      });
    });
  }

  /** 懒加载 bundle.js，并预先算出总字节数 */
  private async loadBundle(onProgress?: (p: OcrProgress) => void): Promise<OcrNamespace> {
    const m = await this.loadManifest();
    if (m) {
      this.totalBytes =
        m.bundle.size +
        m.worker.reduce((s, x) => s + x.size, 0) +
        m.ort.files.reduce((s, x) => s + x.size, 0) +
        Object.values(MODEL_BYTES).reduce((s, x) => s + x, 0);
    }

    if (window.__WeiqiOcrNs) return window.__WeiqiOcrNs;

    // worker 走 new Worker(new URL(...)) 不经过 fetch，无法观测进度。
    // 先 fetch 预热（可统计字节），建 Worker 时命中 HTTP 缓存，几乎无额外耗时。
    if (m) {
      for (const w of m.worker) {
        await this.prefetch(w.path, 'worker', '识别引擎组件（约 11MB）', onProgress);
      }
    }

    const src = toAbs('ocr/bundle.js');
    await this.fetchWithProgress(src, (loaded, total) => {
      onProgress?.({
        stage: 'loading',
        percent: total ? Math.round((loaded / total) * 100) : null,
        message: `正在加载 OCR 引擎…${total ? ` ${fmtBytes(loaded)} / ${fmtBytes(total)}` : ''}`,
        bytes: { loaded, total },
        kind: 'bundle',
      });
    });

    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('OCR 引擎加载失败：ocr/bundle.js'));
      document.head.appendChild(s);
    });
    if (!window.__WeiqiOcrNs) throw new Error('OCR 引擎加载失败：命名空间未注册');
    return window.__WeiqiOcrNs;
  }

  init(onProgress?: (p: OcrProgress) => void): Promise<void> {
    // 幂等：并发调用共享同一个 Promise
    if (this.recognizer) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit(onProgress).catch((e) => {
      this.initPromise = null;
      throw e;
    });
    return this.initPromise;
  }

  private async doInit(onProgress?: (p: OcrProgress) => void): Promise<void> {
    const ns = await this.loadBundle(onProgress);

    const gpu = await probeWebGpu();
    this._webgpuAvailable = gpu.available;
    //
    // 后端选择：能用 GPU 就用 GPU，不能用再降级 CPU。
    //
    // ⚠️ 更正（2026-10-19）：此前写死 'wasm'，理由是「实测 WebGPU 比 WASM 慢 35 倍」。
    //   该结论**无效**：测试环境（本机与编译机）显卡均为 Cirrus Logic GD 5446，
    //   是 QEMU 虚拟显卡，无任何 3D 能力，Chrome 只能走 SwiftShader 软件模拟。
    //   软件模拟下的 WebGPU 慢是必然的，不能推广到真机。真机有独立 GPU 时
    //   WebGPU 通常显著快于 WASM。
    //
    //   之所以此前还叠了部署理由（jsep wasm 27MB > Workers 25MiB 上限），
    //   现已通过将 ORT 改由 CDN 加载解决，不再构成放弃 GPU 的理由。
    //
    // 能用 GPU 就用 GPU，但必须排除软件渲染（其上 WebGPU 比 WASM 慢 35 倍）。
    const backend = gpu.available && !gpu.software ? 'webgpu' : 'wasm';
    this.softwareRenderer = gpu.software;

    // ---- 模型预下载（在主线程，可观测真实字节） ----
    //
    // 为什么不等库自己下载：worker 模式下模型由 Worker 内部 fetch，
    // 主线程的 window.fetch 包装捕获不到（实测“主线程 fetch 捕获: (none)”），
    // 21MB 的下载就完全没有进度了。
    // 这里先在主线程下载一遍：既显示真实字节进度，又把它填进 HTTP 缓存，
    // Worker 随后取用时几乎瞬时命中，不会变成“下载两遍”。
    // 先用 HEAD 取真实体积再求和：硬编码值会随 CDN 文件变更而漂移，
    // 一旦漂移就会出现「已下载 > 总量」的破百显示（实测 23.7MB / 20.5MB）。
    const modelSizes: Record<string, number> = {};
    for (const name of Object.keys(MODEL_BYTES)) {
      const real = await this.headContentLength(MODEL_CDN + name + '_onnx_infer.tar');
      modelSizes[name] = real ?? MODEL_BYTES[name]!;
    }
    const modelTotal = Object.values(modelSizes).reduce((s, x) => s + x, 0);

    let modelDone = 0;
    // 单调守卫：并发/重试可能让回调乱序，进度条绝不允许回退
    let reported = -1;
    for (const [name, size] of Object.entries(modelSizes)) {
      const url = MODEL_CDN + name + '_onnx_infer.tar';
      await this.fetchWithProgress(url, (loaded, total) => {
        // 单文件内也要钳制：响应头缺失时 total 为 0，此时用探测值兜底
        const fileTotal = total > 0 ? total : size;
        const cur = Math.min(modelTotal, modelDone + Math.min(loaded, fileTotal));
        if (cur <= reported) return;
        reported = cur;
        onProgress?.({
          stage: 'initializing',
          percent: modelTotal ? Math.max(0, Math.min(100, Math.round((cur / modelTotal) * 100))) : null,
          message: `正在下载识别模型… ${fmtBytes(cur)} / ${fmtBytes(modelTotal)}`,
          bytes: { loaded: cur, total: modelTotal },
          kind: 'model',
        });
      });
      modelDone += size;
    }

    onProgress?.({
      stage: 'initializing',
      percent: 100,
      message: '模型已就绪，正在启动引擎…',
      bytes: { loaded: modelTotal, total: modelTotal },
      kind: 'model',
    });

    // ---- ORT 运行时预下载（CDN，27MB，占整个下载量的一大半）----
    //
    // ORT 改由 CDN 加载后，这段是整个初始化里最大的一笔流量，
    // 若不做进度就是「点了之后长时间没反应」。这里在主线程先下载一遍：
    //   ① 拿到真实字节进度（npmmirror 响应带 content-length）
    //   ② 填进 HTTP 缓存，Worker/ORT 随后取用几乎瞬时命中
    const m = this.manifest;
    const ortBase = m?.ort?.base || '';
    const ortFiles = m?.ort?.files ?? [];
    let ortPaths: string | undefined;
    if (ortBase && ortFiles.length) {
      const ortTotal = ortFiles.reduce((s, x) => s + x.size, 0);
      let ortDone = 0;
      let ortReported = -1;
      for (const f of ortFiles) {
        const url = ortBase + f.path;
        await this.fetchWithProgress(url, (loaded) => {
          const cur = Math.min(ortTotal, ortDone + Math.min(loaded, f.size));
          if (cur <= ortReported) return;
          ortReported = cur;
          onProgress?.({
            stage: 'initializing',
            percent: ortTotal ? Math.max(0, Math.min(100, Math.round((cur / ortTotal) * 100))) : null,
            message: `正在下载推理运行时… ${fmtBytes(cur)} / ${fmtBytes(ortTotal)}`,
            bytes: { loaded: cur, total: ortTotal },
            kind: 'ort',
          });
        });
        ortDone += f.size;
      }
      onProgress?.({
        stage: 'initializing',
        percent: 100,
        message: '推理运行时就绪',
        bytes: { loaded: ortTotal, total: ortTotal },
        kind: 'ort',
      });
      ortPaths = ortBase;
    } else if (this.manifest) {
      // manifest 存在但无 CDN base（如离线自建部署把 ORT 放回了本地）
      ortPaths = toAbs(ORT_FALLBACK_PATH);
    }

    // Worker 绝对路径：来自 manifest（文件名带内容 hash，不能硬编码）
    const workerRel = this.manifest?.worker[0]?.path;
    const workerUrl = workerRel ? toAbs('ocr/' + workerRel) : '';
    if (!workerUrl) {
      throw new Error('OCR 引擎缺少 worker 资产清单（ocr/manifest.json）');
    }

    const t0 = performance.now();
    this.recognizer = await ns.PaddleOCR.create({
        textDetectionModelName: DET_MODEL,
        textRecognitionModelName: REC_MODEL,
        textDetectionModelAsset: { url: MODEL_CDN + DET_MODEL + '_onnx_infer.tar' },
        textRecognitionModelAsset: { url: MODEL_CDN + REC_MODEL + '_onnx_infer.tar' },
        // 必须显式开启 worker：库的 resolveWorkerOptions 在 worker 缺省时返回
        // { enabled: false }，推理会跑在主线程上。
        // 实测（509×1955 对阵表）：主线程推理独占主线程约 51s
        // （心跳间隙 51.3s、evaluate 延迟 50.6s），UI 完全冻结，
        // 进度条/定时器全然无法刷新 —— 这才是“以为页面卡死”的真正原因。
        // 启用 worker 后心跳间隙降到 161ms，主线程彻底解放。
        //
        // 但不能只传 worker: true —— 库内 createDefaultWorker 用
        //   new URL("./assets/worker-entry-XXX.js", import.meta.url)
        // 而 esbuild 的 es2015 降级把 import.meta 替换成了空对象
        // （实测 bundle 内为 `var import_meta2 = {}`），import.meta.url 为 undefined，
        // 于是抛 "Failed to construct 'URL': Invalid URL"。
        // 传自定义 createWorker（用 manifest 里的绝对路径）即可完全绕过该解析。
        worker: {
          createWorker: () =>
            new Worker(workerUrl, { type: 'module' }),
        },
        ortOptions: {
          backend,
          // CDN 基址；本地回退时为 public/ocr/ort/ 的绝对地址。
          // 不传则库会用默认相对路径去请求包内不存在的 ort 文件 → 404。
          wasmPaths: ortPaths,
        },
      });

    this.initMs = Math.round(performance.now() - t0);
    this._backend = backend === 'webgpu' ? 'webgpu' : 'wasm';

    onProgress?.({ stage: 'initializing', percent: 100, message: '引擎就绪', bytes: { loaded: modelTotal, total: modelTotal }, kind: 'model' });
  }

  async recognize(
    source: Blob | File,
    onProgress?: (p: OcrProgress) => void
  ): Promise<{ items: OcrItem[]; meta: OcrRecognizeMeta }> {
    await this.init(onProgress);
    const rec = this.recognizer;
    if (!rec) throw new Error('OCR 引擎未就绪');

    const { canvas, scale } = await loadAndMaybeUpscale(source);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片转换失败'))), 'image/png');
    });

    // 识别阶段没有进度回调，用「渐近估计」保持进度推进：
    // 以历史耗时为目标，指数逼近 95%，绝不谎报 100%。
    const estimate = this.lastInferMs > 0 ? this.lastInferMs : DEFAULT_INFER_MS;
    const t0 = performance.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const elapsed = performance.now() - t0;
      const ratio = Math.min(1, elapsed / estimate);
      // 指数逼近，前段快后段慢，到 95% 为止
      const pct = Math.round(95 * (1 - Math.exp(-3 * ratio)));
      const leftSec = Math.max(0, Math.round((estimate - elapsed) / 1000));
      onProgress?.({
        stage: 'recognizing',
        percent: pct,
        message:
          leftSec > 1
            ? `正在识别文字…预计还需 ${leftSec} 秒`
            : '正在识别文字…即将完成',
      });
    };
    tick();
    timer = setInterval(tick, 500);

    let results;
    try {
      results = await rec.predict(blob);
    } finally {
      if (timer) clearInterval(timer);
    }

    const inferMs = Math.round(performance.now() - t0);
    this.lastInferMs = inferMs;
    const r = results[0];

    const items: OcrItem[] = (r?.items ?? []).map((it) => {
      const b = polyBounds(it.poly ?? []);
      return {
        text: it.text ?? '',
        score: typeof it.score === 'number' ? it.score : 0,
        x: b ? b.minX / scale : 0,
        y: b ? b.minY / scale : 0,
        w: b ? (b.maxX - b.minX) / scale : 0,
        h: b ? (b.maxY - b.minY) / scale : 0,
      };
    });

    const runtime = r?.runtime;
    const meta: OcrRecognizeMeta = {
      backend: runtime?.detProvider === 'webgpu' ? 'webgpu' : 'wasm',
      webgpuAvailable: runtime?.webgpuAvailable ?? this._webgpuAvailable,
      softwareRenderer: this.softwareRenderer,
      detProvider: runtime?.detProvider ?? 'wasm',
      recProvider: runtime?.recProvider ?? 'wasm',
      initMs: this.initMs,
      inferMs,
      imageWidth: r?.image?.width ?? canvas.width,
      imageHeight: r?.image?.height ?? canvas.height,
    };

    onProgress?.({
      stage: 'recognizing',
      percent: 100,
      message: `识别完成，共 ${items.length} 个文本块（耗时 ${(inferMs / 1000).toFixed(1)}s）`,
    });
    return { items, meta };
  }

  async dispose(): Promise<void> {
    if (this.recognizer) {
      await this.recognizer.dispose().catch(() => undefined);
      this.recognizer = null;
    }
    this.initPromise = null;
  }
}
