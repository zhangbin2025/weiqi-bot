/**
 * OCR 调试日志
 * @module services/ocr/OcrDebug
 *
 * ⚠️ **当前默认开启**（2026-10-19）：排查「少字 / 解析错」期间直接打印，
 * 不必先去开开关。排查结束后应把 DEFAULT_ENABLED 改回 false。
 *
 * 关闭方式（任一命中即关闭）：
 *   1. 控制台执行 `window.__WEIQI_OCR_DEBUG__ = false`
 *   2. 页面 URL 带 `?ocrDebug=0`
 *   3. `localStorage.setItem('weiqi.ocr.debug', '0')`
 *
 * 重新开启：`window.__WEIQI_OCR_DEBUG__ = true`（下次调用即生效，不必刷新）
 *
 * ⚠️ 必须用 `console.log`，不能用 `console.debug`：
 *   Chrome DevTools 的 Verbose 级别**默认折叠**，console.debug 一条都看不见。
 *   实测用户反馈「没有日志啊」就是这个原因 —— 代码在跑，只是被过滤掉了。
 */

/** 日志前缀，便于在控制台过滤：`[OCR] ` */
const PREFIX = '[OCR]';

/** 默认是否开启。排查期 true，稳定后改回 false。 */
const DEFAULT_ENABLED = true;

type GlobalFlag = boolean | undefined;

function readGlobal(): GlobalFlag {
  try {
    const g = globalThis as unknown as { __WEIQI_OCR_DEBUG__?: unknown };
    return g.__WEIQI_OCR_DEBUG__ === true
      ? true
      : g.__WEIQI_OCR_DEBUG__ === false
        ? false
        : undefined;
  } catch {
    return undefined;
  }
}

function urlOff(): boolean {
  try {
    if (typeof location === 'undefined') return false;
    return /[?&]ocrDebug=0\b/.test(location.search || '');
  } catch {
    return false;
  }
}

function storageOff(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('weiqi.ocr.debug') === '0';
  } catch {
    return false;
  }
}

/**
 * 是否开启调试日志
 *
 * 每次调用都重新读取，因此可以在运行中随时开关，不必刷新页面。
 */
export function isOcrDebugEnabled(): boolean {
  const g = readGlobal();
  if (g === true) return true; // 显式开：覆盖 URL / storage
  if (g === false) return false; // 显式关
  if (urlOff() || storageOff()) return false;
  return DEFAULT_ENABLED;
}

/** 显式开关（等价于设置 window.__WEIQI_OCR_DEBUG__） */
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
    console.log(PREFIX, stage, data);
  } catch {
    /* 忽略：console 不可用时不影响主流程 */
  }
}

/**
 * 调试关闭时跳过昂贵的序列化逻辑。
 *
 * 用法：`ocrDebugLazy('buildTable', () => ({ ...heavy }))`
 * 关闭时回调根本不会被调用，避免为日志白算一遍。
 */
export function ocrDebugLazy(stage: string, build: () => unknown): void {
  if (!isOcrDebugEnabled()) return;
  ocrDebug(stage, build());
}

/**
 * 把原始识别块挂到 window，便于在控制台里直接查「某个字到底有没有被检到」
 *
 * 这是排查「名字少字」最有用的一步：
 *   - 块在 → 是被去重/合并丢的，看 `dedupe.drop` / `merge.nearMiss`
 *   - 块不在 → 检测阶段就没检到，属 OCR 本身，调本模块无用
 *
 * 控制台用法：
 * ```js
 * __WEIQI_OCR_ITEMS__.filter(i => i.text.includes('源'))
 * __WEIQI_OCR_ITEMS__.filter(i => i.x>240 && i.x<320 && i.y>2280 && i.y<2380)
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
