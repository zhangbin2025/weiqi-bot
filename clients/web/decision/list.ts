/**
 * 题目列表页面入口
 * @description 按来源/棋谱分组显示生成的题目列表，点击进入答题
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { renderProblemList } from './problems/render';
import { showError } from './problems/utils';

type PhaseFilter = 'all' | 'layout' | 'middle' | 'endgame';

// 筛选选项配置
const PHASE_OPTIONS: { phase: PhaseFilter; label: string }[] = [
  { phase: 'all', label: '全部' },
  { phase: 'layout', label: '布局' },
  { phase: 'middle', label: '中盘' },
  { phase: 'endgame', label: '官子' }
];

// 筛选样式
const FILTER_STYLES = `
  .filter-wrapper { position: relative; }
  .filter-icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.2em;
    padding: 4px;
    transition: transform 0.2s ease;
  }
  .filter-icon-btn:hover { transform: scale(1.1); }
  .filter-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    min-width: 120px;
    display: none;
    z-index: 100;
    margin-top: 4px;
  }
  .filter-dropdown.show { display: block; }
  .filter-option {
    padding: 10px 15px;
    cursor: pointer;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .filter-option:hover { background: #f5f5f5; }
  .filter-option.selected {
    background: #e3f2fd;
    color: #1976d2;
    font-weight: 600;
  }
  .filter-check {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .source-header-controls { position: relative; }
`;

/**
 * 注入筛选样式
 */
function injectFilterStyles(): void {
  const style = document.createElement('style');
  style.textContent = FILTER_STYLES;
  document.head.appendChild(style);
}

/**
 * 渲染筛选下拉菜单
 */
function renderFilterDropdown(currentPhase: PhaseFilter): string {
  return `
    <div class="filter-wrapper">
      <button class="filter-icon-btn" id="filter-icon-btn" title="筛选">🔍</button>
      <div class="filter-dropdown" id="filter-dropdown">
        ${PHASE_OPTIONS.map(opt => `
          <div class="filter-option ${opt.phase === currentPhase ? 'selected' : ''}" data-phase="${opt.phase}">
            <span class="filter-check">${opt.phase === currentPhase ? '✓' : ''}</span>
            <span>${opt.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * 从 URL 读取筛选参数
 */
function getPhaseFromUrl(): PhaseFilter {
  const params = new URLSearchParams(window.location.search);
  const phase = params.get('phase') as PhaseFilter;
  return PHASE_OPTIONS.some(opt => opt.phase === phase) ? phase : 'all';
}

/**
 * 更新 URL 参数
 */
function updateUrl(phase: PhaseFilter): void {
  const url = new URL(window.location.href);
  if (phase === 'all') {
    url.searchParams.delete('phase');
  } else {
    url.searchParams.set('phase', phase);
  }
  window.history.replaceState({}, '', url.toString());
}

/**
 * 按阶段过滤题目
 */
function filterProblemsByPhase(problems: any[], phase: PhaseFilter): any[] {
  return phase === 'all' ? problems : problems.filter(p => p.phase === phase);
}

/**
 * 主渲染函数
 */
async function renderWithFilter(
  problems: any[],
  favoriteId: string,
  data: Record<string, unknown>,
  readMarkService: any,
  phase: PhaseFilter
): Promise<void> {
  const filteredProblems = filterProblemsByPhase(problems, phase);
  const filteredData = { ...data };
  delete filteredData['gameGroups']; // 强制重新计算分组
  
  const filterDropdownHtml = renderFilterDropdown(phase);
  await renderProblemList(filteredProblems, favoriteId, filteredData, readMarkService, phase, filterDropdownHtml);
  
  bindFilterEvents(problems, favoriteId, data, readMarkService, phase);
}

/**
 * 绑定筛选按钮事件
 */
function bindFilterEvents(
  problems: any[],
  favoriteId: string,
  data: Record<string, unknown>,
  readMarkService: any,
  currentPhase: PhaseFilter
): void {
  const filterIconBtn = document.getElementById('filter-icon-btn');
  const filterDropdown = document.getElementById('filter-dropdown');
  
  if (!filterIconBtn || !filterDropdown) return;

  // 点击筛选图标，切换下拉菜单
  filterIconBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    filterDropdown.classList.toggle('show');
  });

  // 点击下拉选项
  filterDropdown.querySelectorAll('.filter-option').forEach(option => {
    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      const phase = (option as HTMLElement).dataset['phase'] as PhaseFilter;
      if (!phase) return;

      updateUrl(phase);
      filterDropdown.classList.remove('show');
      await renderWithFilter(problems, favoriteId, data, readMarkService, phase);
    });
  });

  // 点击外部关闭下拉菜单
  document.addEventListener('click', () => {
    filterDropdown.classList.remove('show');
  });
}

async function main() {
  injectFilterStyles();
  
  const ctx = await WebBootstrap.init({ containerId: 'page-root' });
  const { favoriteService, readMarkService } = ctx;
  const params = new URLSearchParams(window.location.search);
  const favoriteId = params.get('favoriteId');

  if (!favoriteId) {
    showError('缺少题目ID');
    return;
  }

  try {
    const fav = await favoriteService?.getById(favoriteId);
    if (!fav?.data) {
      showError('题目不存在');
      return;
    }

    const problems = (fav.data['problems'] as any[]) || [];
    const phase = getPhaseFromUrl();
    
    await renderWithFilter(problems, favoriteId, fav.data, readMarkService, phase);
    
    // 监听 pageshow 事件，当页面从 bfcache 恢复时重新渲染
    window.addEventListener('pageshow', async (event) => {
      if (event.persisted) {
        await renderWithFilter(problems, favoriteId, fav.data, readMarkService, getPhaseFromUrl());
      }
    });
  } catch (e) {
    console.error('加载题目列表失败', e instanceof Error ? e : new Error(String(e)));
    showError('加载失败');
  }
}

main().catch(console.error);
