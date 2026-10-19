/**
 * OCR 调试日志
 * @module services/ocr/OcrDebug
 *
 * 默认**关闭**：OCR 全流程会产生上千个文本块，无脑打印会把控制台淹掉。
 *
 * 三种开启方式（任一命中即生效，可在运行时随时切换）：
 *   1. 控制台执行 `window.__WEIQI_OCR_DEBUG__ = true`
 *   2. 页面 URL 带 `?ocrDebug=1`
 *   3. `localStorage.setItem('weiqi.ocr.debug', '1')`
 *
 * 关闭时 `ocrDebug` 只是一个布尔判断 + 立即返回，不影响正常路径性能。
 */

/** 日志前缀，便于在控制台过滤：`[OCR] ` */
const PREFIX = '[OCR]';

function flagFromGlobal(): boolean {
  try {
    const g = globalThis as unknown as { __WEIQI_OCR_DEBUG__?: unknown };
    return g.__WEIQI_OCR_DEBUG__ === true;
  } catch {
    return false;
  }
}

function flagFromUrl(): boolean {
  try {
    if (typeof location === 'undefined') return false;
    return /[?&]ocrDebug=1\b/.test(location.search || '');
  } catch {
    return false;
  }
}

function flagFromStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('weiqi.ocr.debug') === '1';
  } catch {
    return false;
  }
}

/**
 * 是否开启调试日志
 *
 * 每次调用都重新读取，因此可以在运行中随时开关，
 * 不必刷新页面（便于「开 → 复现 → 关」）。
 */
export function isOcrDebugEnabled(): boolean {
  return flagFromGlobal() || flagFromUrl() || flagFromStorage();
}

/** 显式开启（等价于设置 window.__WEIQI_OCR_DEBUG__ = true） */
export function setOcrDebugEnabled(enabled: boolean): void {
  try {
    (globalThis as unknown as { __WEIQI_OCR_DEBUG__?: boolean }).__WEIQI_OCR_DEBUG__ = enabled;
  } catch {
    /* 忽略：环境不支持 globalThis 时静默失败 */
  }
}

/**
 * 输出一条调试日志
 *
 * @param stage 阶段名，如 `tiling` / `buildTable` / `parse`
 * @param data 任意可序列化数据
 */
export function ocrDebug(stage: string, data?: unknown): void {
  if (!isOcrDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(PREFIX, stage, data);
  } catch {
    /* 忽略：console 不可用时不影响主流程 */
  }
}

/**
 * 把原始识别块挂到 window，便于在控制台里直接查「某个字到底有没有被检到」
 *
 * 这是排查「名字少字」最有用的一步：
 *   - 块在 → 是被去重/合并丢的，看 `dedupe.drop` / `merge.nearMiss`
 *   - 块不在 → 检测阶段就没检到，属 OCR 本身，调本模块无用
 *
 * 开启调试后用法（控制台）：
 * ```js
 * // 查某个区域的所有块
 * __WEIQI_OCR_ITEMS__.filter(i => i.x>240 && i.x<320 && i.y>2280 && i.y<2380)
 * // 查含某字的块
 * __WEIQI_OCR_ITEMS__.filter(i => i.text.includes('源'))
 * ```
 */
export function ocrExpose(items: readonly unknown[]): void {
  if (!isOcrDebugEnabled()) return;
  try {
    (globalThis as unknown as { __WEIQI_OCR_ITEMS__?: unknown[] }).__WEIQI_OCR_ITEMS__ =
      items as unknown[];
    ocrDebug('expose', { 块数: (items as unknown[]).length, 已挂载: '__WEIQI_OCR_ITEMS__' });
  } catch {
    /* 忽略 */
  }
}

/**
 * 调试开关状态下的便捷包装：只在开启时执行昂贵的序列化逻辑。
 *
 * 用法：`ocrDebugLazy('buildTable', () => ({ ...heavy }))`
 * 关闭时回调根本不会被调用，避免为日志白算一遍。
 */
export function ocrDebugLazy(stage: string, build: () => unknown): void {
  if (!isOcrDebugEnabled()) return;
  ocrDebug(stage, build());
}
