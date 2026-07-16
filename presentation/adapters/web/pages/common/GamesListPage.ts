/**
 * 公共棋谱列表页面
 * @module presentation/pages/common/GamesListPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ICard, IToast, PageParams } from '../../../../core/interfaces';
import type { IReadMarkService } from '../../../../../services/readmark';
import type { IGameListProvider } from './IGameListProvider';
import type { IGameService } from '../../../../../services/game/IGameService';
import type { IGameHistoryStorage } from '../../../../../services/game/IGameHistoryStorage';
import { formatGameResult } from '../../../../../domain/game/GameResult';
/** 棋谱条目 */
export interface GameItem {
  id: string;
  black: string;
  white: string;
  date: string;
  result?: string;
  sgf?: string;
  archiveId?: string;  // 归档ID，用于加载SGF
}
/** 棋谱列表页面配置 */
export interface GamesListPageConfig {
  readMarkService: IReadMarkService;
  category: string;
  providers: Map<string, IGameListProvider>;
  gameService: IGameService;
  gameHistoryStorage?: IGameHistoryStorage | undefined;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onClearReadMarks?: () => void;
  /** 自定义条目点击回调，返回 false 表示继续执行默认跳转逻辑 */
  onItemClick?: (game: GameItem) => boolean | void;
}
/** 公共棋谱列表页面 */
export class GamesListPage implements IPage {
  get title(): string {
    return this._title;
  }
  private _title = '棋谱列表';
  private readMarkService: IReadMarkService;
  private category: string;
  private providers: Map<string, IGameListProvider>;
  private gameService: IGameService;
  private gameHistoryStorage?: IGameHistoryStorage | undefined;
  private card: ICard;
  private toast: IToast;
  private games: GameItem[] = [];
  private readMarkIds: string[] = [];
  private currentUserId: string | undefined;  // 当前用户ID，用于高亮
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private onClearReadMarks?: (() => void) | undefined;
  private customItemClick?: ((game: GameItem) => boolean | void | Promise<void>) | undefined; // 自定义条目点击回调
  private initialized = false;
  constructor(config: GamesListPageConfig) {
    this.readMarkService = config.readMarkService;
    this.category = config.category;
    this.providers = config.providers;
    this.gameService = config.gameService;
    this.gameHistoryStorage = config.gameHistoryStorage;
    this.onNavigate = config.onNavigate;
    this.onClearReadMarks = config.onClearReadMarks;
    this.customItemClick = config.onItemClick; // 自定义条目点击回调
    this.card = AdapterFactory.createCard();
    this.toast = AdapterFactory.createToast();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }
  handleParams(params: PageParams): void {
    if (params['gamesJson']) {
      try {
        this.games = JSON.parse(params['gamesJson']);
      } catch {
        console.warn('解析棋谱数据失败');
        this.games = [];
      }
    }
    if (params['title']) {
      this._title = params['title'];
    }
    if (params['userId']) {
      this.currentUserId = params['userId'];
    }
    this.loadReadMarks();
    this.render();
  }
  /** 加载棋谱数据（通过 category 和 key） */
  async loadGames(category: string, key: string, currentUserId?: string): Promise<void> {
    this.category = category;  // 更新 category，确保已读标记类别匹配
    this.currentUserId = currentUserId;
    const provider = this.providers.get(category);
    if (!provider) {
      console.error(`未找到 category="${category}" 的棋谱列表提供者`);
      this.toast.error('未找到数据提供者');
      this.games = [];
      this.render();
      return;
    }
    try {
      const archiveIds = await provider.getGameArchiveIds(key);
      // 从归档存储加载元数据（如果提供了 gameHistoryStorage）
      const games: GameItem[] = [];
      for (const archiveId of archiveIds) {
        if (this.gameHistoryStorage) {
          const item = await this.gameHistoryStorage.findById(archiveId);
          if (item && item.metadata) {
            const result = (item.metadata['result'] as string) || undefined;
            const black = (item.metadata['blackName'] as string) || (item.metadata['black'] as string) || '';
            const white = (item.metadata['whiteName'] as string) || (item.metadata['white'] as string) || '';
            games.push({
              id: archiveId,  // 使用 archiveId 作为唯一标识，确保每个条目的id唯一
              archiveId: archiveId,
              black,
              white,
              date: (item.metadata['date'] as string) || '',
              ...(result ? { result } : {}),
            });
          }
        } else {
          // 如果没有 gameHistoryStorage，从 archiveId 解析 gameId（格式：${ts}-${gameId}）
          const gameId = archiveId.split('-').slice(1).join('-') || archiveId;
          games.push({
            id: gameId,
            archiveId,
            black: '-',
            white: '-',
            date: '-',
          });
        }
      }
      this.games = games;
      await this.loadReadMarks();
      this.render();
    } catch (e) {
      console.error('加载棋谱数据失败', e as Error);
      this.toast.error('加载失败');
      this.games = [];
      this.render();
    }
  }
  /** 设置棋谱数据 */
  async setData(games: GameItem[]): Promise<void> {
    this.games = games;
    await this.loadReadMarks();
    this.render();
  }
  /** 加载已读标记 */
  private async loadReadMarks(): Promise<void> {
    this.readMarkIds = await this.readMarkService.getReadMarks(this.category);
  }
  /** 清除已读标记 */
  async clearReadMarks(): Promise<void> {
    await this.readMarkService.clearReadMarks(this.category);
    this.readMarkIds = [];
    this.onClearReadMarks?.();
    this.render();
  }
  /**
   * 刷新已读标记（用于页面从缓存恢复时）
   */
  async refreshReadMarks(): Promise<void> {
    await this.loadReadMarks();
    this.render();
  }
  /** 点击条目 */
  async onItemClick(gameId: string): Promise<void> {
    const game = this.games.find(g => g.id === gameId);
    if (!game) return;
    // 标记已读
    await this.readMarkService.markRead(this.category, gameId);
    this.readMarkIds.push(gameId);
    // 优先使用外部传入的自定义点击回调
    if (this.customItemClick) {
      const result: boolean | void | Promise<void> = this.customItemClick(game);
      // 如果返回 false，继续执行默认逻辑
      if (result !== false) {
        return; // 返回其他值（undefined 或 true），阻止默认逻辑
      }
    }
    // 默认逻辑：跳转到 replay
    if (!game.archiveId) return;
    if (this.onNavigate) {
      this.onNavigate('replay', {
        archiveId: game.archiveId,
      });
    }
  }
  render(): void {
    const container = document.getElementById('page-root');
    if (!container) return;
    const total = this.games.length;
    const readCount = this.games.filter(g => this.readMarkIds.includes(g.id)).length;
    const statsHtml = `📋 共 ${total} 局，已读 ${readCount} 局`;
    const clearBtnHtml = `<div class="source-header-controls">
      <button class="icon-btn" id="clearReadBtn" title="清除已读标记">👁️</button>
    </div>`;
    if (this.games.length === 0) {
      container.innerHTML = `
        <div class="source-group">
          <div class="source-header">
            <span>${statsHtml}</span>
            ${clearBtnHtml}
          </div>
          <div style="padding:20px;">
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <div>暂无棋谱</div>
            </div>
          </div>
        </div>
      `;
      this.bindClearBtn();
      return;
    }
    const cardsHtml = this.games.map((game, index) => {
      const isRead = this.readMarkIds.includes(game.id);
      const isBlack = game.black === this.currentUserId;
      const isWhite = game.white === this.currentUserId;
      const resultText = formatGameResult(game.result);
      let resultClass = '';
      if (resultText.includes('黑')) {
        resultClass = isBlack ? 'result-win' : 'result-lose';
      } else if (resultText.includes('白')) {
        resultClass = isWhite ? 'result-win' : 'result-lose';
      }
      return `
        <div class="game-card-wrapper ${isRead ? 'viewed' : ''}" data-index="${index}" data-id="${game.id}">
          <div class="game-card">
            <div class="game-header">
              <div class="game-players">
                <span class="${isBlack ? 'player-self' : ''}">
                  <span class="stone-icon stone-black"></span>${game.black || '黑棋'}
                </span>
                <span class="player-vs">vs</span>
                <span class="${isWhite ? 'player-self' : ''}">
                  <span class="stone-icon stone-white"></span>${game.white || '白棋'}
                </span>
              </div>
              ${game.result ? `<span class="game-result ${resultClass}">${resultText}</span>` : ''}
            </div>
            <div class="game-footer">
              <span>${game.date || '-'}</span>
              <span class="game-btn">📖 棋谱</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    container.innerHTML = `
      <div class="source-group">
        <div class="source-header">
          <span>${statsHtml}</span>
          ${clearBtnHtml}
        </div>
        <div class="game-list">
          ${cardsHtml}
        </div>
      </div>
    `;
    // 绑定卡片点击
    container.querySelectorAll('.game-card-wrapper').forEach(el => {
      el.addEventListener('click', async () => {
        const gameId = (el as HTMLElement).dataset['id'];
        if (gameId) await this.onItemClick(gameId);
      });
    });
    this.bindClearBtn();
  }
  private bindClearBtn(): void {
    const clearBtn = document.getElementById('clearReadBtn');
    if (clearBtn) {
      clearBtn.onclick = () => this.clearReadMarks();
    }
  }
  destroy(): void {
    this.card.destroy();
    this.toast.destroy();
    this.games = [];
    this.readMarkIds = [];
    this.initialized = false;
  }
}
