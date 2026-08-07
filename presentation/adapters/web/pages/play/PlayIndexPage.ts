/**
 * 对弈导航页
 * @module presentation/pages/play/PlayIndexPage
 */
import { AdapterFactory } from '../../../../adapters';
import type { IPage, ICard, PageParams } from '../../../../core/interfaces';
export interface PlayIndexPageConfig {
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
export class PlayIndexPage implements IPage {
  readonly title = '围棋对弈';
  private card: ICard;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  constructor(config: PlayIndexPageConfig) {
    this.onNavigate = config.onNavigate;
    this.card = AdapterFactory.createCard();
  }
  async initialize(): Promise<void> {
    this.render();
  }
  handleParams(_params: PageParams): void {}
  render(): void {
    this.card.setContent([
      '🎮 围棋对弈',
      '',
      '👥 [真人对弈]',
      '   创建房间邀请好友',
      '',
      '🎯 [人机对弈]',
      '   与 KataGo AI 对弈',
      '',
      '🤖 [AI自对弈]',
      '   观摩 AI 自我对局',
      '',
      '📋 [历史对局]',
    ].join('\n'));
    this.card.render();
  }
  destroy(): void {
    this.card.destroy();
  }
}
