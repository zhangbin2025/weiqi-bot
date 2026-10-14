/**
 * 标签页切换与状态恢复
 * @description 跳到其他页面再返回时，Android WebView / Electron 不支持 bfcache，
 *              整页重载会回到 HTML 里写死的默认页（生成）。
 *              所以当前标签存 sessionStorage，启动时恢复。
 */

/** sessionStorage 键：当前激活的标签 */
export const TAB_STORAGE_KEY = 'decision_active_tab';

const TAB_SELECTOR = '.tab';
const CONTENT_SELECTOR = '.tab-content';

/**
 * 激活指定标签
 * @param tabName 标签名（generate / import / history）
 * @param persist 是否写入 sessionStorage（恢复时传 false，避免用旧值覆盖）
 */
export function activateTab(tabName: string, persist = true): void {
  if (!tabName) return;
  const tabs = document.querySelectorAll(TAB_SELECTOR);
  const contents = document.querySelectorAll(CONTENT_SELECTOR);

  tabs.forEach(t => t.classList.remove('active'));
  document.querySelector(`${TAB_SELECTOR}[data-tab="${tabName}"]`)?.classList.add('active');

  contents.forEach(content => {
    content.classList.remove('active');
    if (content.id === `${tabName}-tab`) {
      content.classList.add('active');
    }
  });

  if (persist) {
    try { sessionStorage.setItem(TAB_STORAGE_KEY, tabName); } catch {
      /* 隐私模式下 sessionStorage 不可用，忽略 */
    }
  }
}

/**
 * 初始化标签切换，并恢复上次所在标签
 * @description 恢复失败（无存储 / 存储值已失效）时保持 HTML 里的默认页
 */
export function initTabs(): void {
  const tabs = document.querySelectorAll(TAB_SELECTOR);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activateTab((tab as HTMLElement).dataset['tab'] || '');
    });
  });

  try {
    const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (saved && document.querySelector(`${TAB_SELECTOR}[data-tab="${saved}"]`)) {
      activateTab(saved, false);
    }
  } catch {
    /* ignore */
  }
}
