/**
 * 定式首页入口
 * @description 加载定式数量统计
 */

import { JosekiLoader } from '../../../services/joseki/JosekiLoader';
import { NetworkManager } from '../../../infrastructure/network/core/NetworkManager';
import { DirectProvider } from '../../../infrastructure/network/adapters/web/DirectProvider';

async function main() {
  const countEl = document.getElementById('josekiCount');
  if (!countEl) return;

  try {
    // 加载元数据获取定式数量
    const metaUrl = '../shared/assets/data/joseki/trie-meta.json';
    const response = await fetch(metaUrl);
    if (response.ok) {
      const meta = await response.json();
      countEl.textContent = (meta.total ?? 0).toLocaleString();
    } else {
      countEl.textContent = '--';
    }
  } catch (e) {
    console.error('加载定式数量失败:', e);
    countEl.textContent = '--';
  }
}

main();
