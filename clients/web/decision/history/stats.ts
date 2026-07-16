/**
 * 统计卡片显示（参考 weiqi-page 实战选点卡片）
 * @description 显示生成结果统计信息
 */

/**
 * 显示生成结果
 * 使用三列阶段统计 + 三色等级标签，与 weiqi-page 实战选点卡片保持一致
 */
export function showGenerateResult(result: any): void {
  const statsSection = document.getElementById('stats-section') as HTMLElement;
  const stats = result.stats || { phases: {}, levels: {} };

  if (statsSection) statsSection.style.display = 'block';

  // 三列阶段统计：布局 / 中盘 / 官子
  const statLayout = document.getElementById('stat-layout') as HTMLElement;
  const statMiddle = document.getElementById('stat-middle') as HTMLElement;
  const statEndgame = document.getElementById('stat-endgame') as HTMLElement;
  if (statLayout) statLayout.textContent = String(stats.phases?.layout ?? 0);
  if (statMiddle) statMiddle.textContent = String(stats.phases?.middle ?? 0);
  if (statEndgame) statEndgame.textContent = String(stats.phases?.endgame ?? 0);

  // 三色等级标签：职业 / 高段 / 普通
  const statLevels = document.getElementById('stat-levels') as HTMLElement;
  if (statLevels) {
    const pro = stats.levels?.pro ?? 0;
    const high = stats.levels?.high ?? 0;
    const normal = stats.levels?.normal ?? 0;
    statLevels.innerHTML = `
      <span class="level-tag pro">职业 ${pro}</span>
      <span class="level-tag high">高段 ${high}</span>
      <span class="level-tag normal">普通 ${normal}</span>
    `;
  }

  // 点击卡片跳转题目列表
  const cardLink = document.getElementById('stats-card-link') as HTMLAnchorElement;
  if (cardLink && result.favoriteId) {
    cardLink.href = `list.html?favoriteId=${result.favoriteId}`;
  }
}
