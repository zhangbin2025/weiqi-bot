/**
 * 进程环境安全检测
 * @description 安全地检测 process.versions，避免在 Vite 浏览器环境下抛异常
 *
 * 问题根因：Vite 开发模式下可能注入 process polyfill，
 * 导致 typeof process !== 'undefined' 为 true，
 * 但访问 process.versions 时可能抛异常（被外层 catch 吞掉）。
 *
 * 修复方案：所有 process.versions 访问都通过本模块的 try-catch 安全检测。
 */

/** 安全检测是否为 Node.js 环境 */
export function isNodeJs(): boolean {
  try {
    return typeof process !== 'undefined' && process.versions?.node != null;
  } catch {
    return false;
  }
}

/** 安全检测是否为 Electron 环境 */
export function isElectron(): boolean {
  try {
    return typeof process !== 'undefined' && process.versions?.['electron'] != null;
  } catch {
    return false;
  }
}

/** 安全检测是否为 CLI 环境（Node.js 但非 Electron） */
export function isCli(): boolean {
  return isNodeJs() && !isElectron();
}
