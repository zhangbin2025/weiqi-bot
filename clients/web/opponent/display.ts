/**
 * 统计展示模块
 */

import type { OpponentAnalysisResultWithBookmark } from '../../application/opponent';
import { calculateGameStats, calculateJosekiStats } from './stats-calculator';

/**
 * 显示统计数据
 */
export function displayStats(
  data: OpponentAnalysisResultWithBookmark,
  statsSection: HTMLElement
): void {
  const games = data.games || [];
  const gamesCount = games.length;

  // 计算统计
  const stats = calculateGameStats(games, data.foxwqId);
  const josekiStats = calculateJosekiStats(data);

  const bookmarkIcon = data.bookmarkId ? '★ 已收藏' : '';

  statsSection.innerHTML = `
    <div class="stats-card" onclick="window.viewGames()">
      <h3>📋 棋谱统计 ${bookmarkIcon}</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${gamesCount}</div>
          <div class="stat-label">总对局数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.opponentsCount}</div>
          <div class="stat-label">对弈对手</div>
        </div>
        <div class="stat-item stat-item-full">
          <div class="stat-value">${stats.topOpponent}</div>
          <div class="stat-label">活跃对手</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" style="font-size:1em">${stats.firstDate || '-'}</div>
          <div class="stat-label">最早对局</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" style="font-size:1em">${stats.lastDate || '-'}</div>
          <div class="stat-label">最新对局</div>
        </div>
      </div>
    </div>

    <div class="stats-card" onclick="window.viewJoseki()">
      <h3>📚 定式发现</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${josekiStats.total}</div>
          <div class="stat-label">匹配定式数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${josekiStats.hot}</div>
          <div class="stat-label">🔥 热门</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${josekiStats.hit}</div>
          <div class="stat-label">🎯 命中</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${josekiStats.complex}</div>
          <div class="stat-label">🧩 复杂</div>
        </div>
      </div>
    </div>
  `;

  statsSection.classList.add('show');
}

/**
 * 显示加载状态
 */
export function showLoading(statsSection: HTMLElement, foxwqId: string): void {
  statsSection.innerHTML = `
    <div class="card">
      <div style="text-align: center; padding: 20px;">
        <div class="spinner"></div>
        <p>正在分析 "${foxwqId}" 的棋谱...</p>
        <p style="font-size: 0.85em; color: #888; margin-top: 8px;">
          请耐心等待，分析需要一定时间...
        </p>
      </div>
    </div>
  `;
  statsSection.style.display = 'block';
}

/**
 * 显示进度
 */
export function showProgress(
  statsSection: HTMLElement,
  percent: number,
  status: string,
  detail?: string
): void {
  // 优化 detail 显示：如果是下载棋谱，只显示进度而不显示 chessid
  let detailText = '';
  if (detail) {
    const match = detail.match(/^(\d+\/\d+):/);
    if (match) {
      detailText = match[1];
    } else if (detail.length > 20) {
      detailText = '处理中...';
    } else {
      detailText = detail;
    }
  }

  statsSection.innerHTML = `
    <div class="card">
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 24px; margin-bottom: 10px;">${percent}%</div>
        <div style="font-size: 16px; color: #666;">${status}</div>
        ${detailText ? `<div style="font-size: 14px; color: #999; margin-top: 5px;">${detailText}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * 显示错误
 */
export function showError(statsSection: HTMLElement, message: string): void {
  statsSection.innerHTML = `
    <div class="card">
      <div style="background: #ffebee; color: #c62828; padding: 12px; border-radius: 8px; text-align: center;">
        <strong>分析失败</strong>
        <p>${message}</p>
      </div>
    </div>
  `;
  statsSection.classList.add('show');
}
