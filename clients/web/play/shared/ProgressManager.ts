/**
 * 进度管理器
 * @module clients/web/play/shared/ProgressManager
 */

/**
 * 显示加载进度
 */
export function showLoading(text: string = '正在加载...'): void {
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const loadingProgress = document.getElementById('loadingProgress');
  
  if (overlay) {
    overlay.style.display = 'flex';
  }
  if (loadingText) {
    loadingText.textContent = text;
  }
  if (loadingProgress) {
    loadingProgress.textContent = '准备下载...';
  }
}

/**
 * 更新进度
 */
export function updateProgress(loaded: number, total: number, progress: number): void {
  const loadingProgress = document.getElementById('loadingProgress');
  
  if (!loadingProgress) {
    console.warn('[ProgressManager] loadingProgress element not found');
    return;
  }
  
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  // 如果已下载量超过或等于总量，只显示已下载大小，不显示总量
  if (loaded >= total && total > 0) {
    loadingProgress.textContent = `已下载 ${formatSize(loaded)}`;
  } else if (total > 0) {
    loadingProgress.textContent = `${formatSize(loaded)} / ${formatSize(total)} (${Math.round(progress)}%)`;
  } else {
    loadingProgress.textContent = `${Math.round(progress)}%`;
  }
  
  // 强制 UI 更新（使用 requestAnimationFrame）
  // 这样可以避免浏览器的批量渲染优化，确保进度实时显示
  requestAnimationFrame(() => {
    // 触发重绘
    loadingProgress.style.display = loadingProgress.style.display;
  });
}

/**
 * 隐藏加载进度
 */
export function hideLoading(): void {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * 设置加载文本
 */
export function setLoadingText(text: string): void {
  const loadingText = document.getElementById('loadingText');
  if (loadingText) {
    loadingText.textContent = text;
  }
}

/**
 * 设置初始化阶段消息（用于 AI 引擎初始化进度）
 */
export function setInitProgress(message: string): void {
  const loadingText = document.getElementById('loadingText');
  const loadingProgress = document.getElementById('loadingProgress');
  
  if (loadingText) {
    loadingText.textContent = '正在初始化 AI 引擎...';
  }
  if (loadingProgress) {
    loadingProgress.textContent = message;
  }
}

// 暴露到全局，方便其他模块调用
if (typeof window !== 'undefined') {
  (window as any).setLoadingText = setLoadingText;
  (window as any).setInitProgress = setInitProgress;
}
