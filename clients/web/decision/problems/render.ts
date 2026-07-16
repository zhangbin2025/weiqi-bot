/**
 * 题目列表渲染
 * @description 渲染题目列表和游戏卡片
 */

import { GameGroup, PhaseStats, normalizeGroups } from './normalize';
import { escapeHtml, escapeAttr, getSourceText, getLevelText, formatResult } from './utils';
import type { IReadMarkService } from '../../../../services/readmark';

/**
 * 渲染题目列表
 */
export async function renderProblemList(
  problems: any[], 
  favoriteId: string, 
  data: Record<string, unknown>,
  readMarkService: IReadMarkService
): Promise<void> {
  const listContainer = document.getElementById('problem-list');
  if (!listContainer) return;

  if (problems.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div>暂无题目</div>
      </div>
    `;
    return;
  }

  const groups = normalizeGroups(problems, data);
  const source = String(data['source'] || 'foxwq');
  const sourceName = getSourceText(source);
  const totalProblems = groups.reduce((sum, group) => sum + group.problemsCount, 0);

  // 加载已读标记
  const category = `decision:${favoriteId}`;
  const readMarks = await readMarkService.getReadMarks(category);
  const readMarkSet = new Set(readMarks);
  
  listContainer.innerHTML = `
    <div class="source-group">
      <div class="source-header">
        <span>🏷️ ${sourceName} (${groups.length}份, ${totalProblems}题)</span>
        <div class="source-header-controls">
          <button class="icon-btn" id="clear-visited-btn" title="清除已读标记">👁️</button>
        </div>
      </div>
      <div class="quiz-list">
        ${groups.map((group, groupIndex) => renderGameCard(group, favoriteId, groupIndex, readMarkSet)).join('')}
      </div>
    </div>
  `;

  // 绑定卡片点击事件
  listContainer.querySelectorAll('.quiz-card-wrapper').forEach(item => {
    item.addEventListener('click', async () => {
      const el = item as HTMLElement;
      const index = parseInt(el.dataset['problemIndex'] || '0', 10);
      const groupIndex = parseInt(el.dataset['groupIndex'] || '-1', 10);
      const gameId = el.dataset['gameId'];
      
      // 标记已读
      if (gameId) {
        await readMarkService.markRead(category, gameId);
      }
      
      const groupParam = groupIndex >= 0 ? `&groupIndex=${groupIndex}` : '';
      window.location.href = `quiz.html?favoriteId=${encodeURIComponent(favoriteId)}&problemIndex=${index}${groupParam}`;
    });
  });

  // 绑定棋谱按钮点击事件
  listContainer.querySelectorAll('.game-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const archiveId = (btn as HTMLElement).dataset['archiveId'];
      if (archiveId) {
        window.location.href = `../replay/index.html?archiveId=${encodeURIComponent(archiveId)}`;
      }
    });
  });

  // 清除已读标记按钮
  const clearVisitedBtn = document.getElementById('clear-visited-btn');
  clearVisitedBtn?.addEventListener('click', async () => {
    await readMarkService.clearReadMarks(category);
    
    // 移除所有 visited 样式，不刷新页面
    listContainer.querySelectorAll('.quiz-card.visited').forEach(card => {
      card.classList.remove('visited');
    });
  });
}

/**
 * 渲染游戏卡片
 */
function renderGameCard(group: GameGroup, favoriteId: string, groupIndex: number, readMarkSet: Set<string>): string {
  const firstProblemIndex = group.problemIndexes[0] ?? 0;
  const black = group.black || '黑棋';
  const white = group.white || '白棋';
  const event = group.event || group.gameName || `${black} vs ${white}`;
  const result = formatResult(group.result || '');
  const level = getLevelText(group.gameLevel || 'normal');
  const phases = renderPhaseStats(group.phaseStats);
  const visited = readMarkSet.has(group.gameId) ? ' visited' : '';

  return `
    <div class="quiz-card-wrapper" data-problem-index="${firstProblemIndex}" data-group-index="${groupIndex}" data-game-id="${escapeAttr(group.gameId)}">
      <div class="quiz-card${visited}">
        <div class="quiz-header">
          <span class="players">
            <span class="stone-icon stone-black"></span>${escapeHtml(black)}${group.blackRank ? `<span class="rank">${escapeHtml(group.blackRank)}</span>` : ''}
            <span class="vs">vs</span>
            <span class="stone-icon stone-white"></span>${escapeHtml(white)}${group.whiteRank ? `<span class="rank">${escapeHtml(group.whiteRank)}</span>` : ''}
          </span>
        </div>
        <div class="event">${escapeHtml(event)}</div>
        <div class="stats">
          <span class="count">${group.problemsCount}题</span>
          ${phases}
          <span class="level" data-level="${level}">${level}</span>
        </div>
        <div class="quiz-footer">
          <span class="result">${escapeHtml(result || '结果未知')}</span>
          ${group.archiveId ? `<span class="game-btn" data-archive-id="${escapeAttr(group.archiveId)}">📖 棋谱</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * 渲染阶段统计
 */
function renderPhaseStats(stats: PhaseStats): string {
  const parts: string[] = [];
  if (stats.layout) parts.push(`<span class="phase">布局${stats.layout}</span>`);
  if (stats.middle) parts.push(`<span class="phase">中盘${stats.middle}</span>`);
  if (stats.endgame) parts.push(`<span class="phase">官子${stats.endgame}</span>`);
  return parts.join('');
}
