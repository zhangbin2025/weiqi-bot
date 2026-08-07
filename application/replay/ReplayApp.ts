/**
 * 棋谱查看应用编排器
 * @module application/replay/ReplayApp
 */
import { sgfToReplayData, type ReplayData } from '../../domain/sgf';
import { SGFParser } from '../../domain/sgf';
import type { IExportService, ExportResult } from '../../services/export';
import type { IAudioPlayer, SoundType } from '../../infrastructure/audio';
import type { IGameService } from '../../services/game/IGameService';
import type { ISessionService } from '../../services/session';
export interface ReplayLoadOptions {
  defaultMove?: number;
  gameName?: string;
}
export class ReplayApp {
  constructor(
    private readonly exportService: IExportService,
    private readonly audioPlayer: IAudioPlayer,
    private readonly gameService?: IGameService,
    private readonly sessionService?: ISessionService,
  ) {}
  /**
   * 从归档ID加载棋谱
   */
  async loadByArchiveId(archiveId: string): Promise<string | null> {
    if (!this.gameService) {
      console.warn('GameService 未注入');
      return null;
    }
    const sgf = await this.gameService.getByArchiveId(archiveId);
    if (!sgf) {
      console.warn('归档不存在', { archiveId });
      return null;
    }
    // console.info('从归档加载棋谱成功', { archiveId });
    return sgf;
  }
  /**
   * 从会话ID加载棋谱
   */
  async loadBySessionId(sessionId: string): Promise<string | null> {
    if (!this.sessionService) {
      console.warn('SessionService 未注入');
      return null;
    }
    const session = await this.sessionService.get<{ sgf: string }>(sessionId);
    if (!session) {
      console.warn('会话不存在或已过期', { sessionId });
      return null;
    }
    // console.info('从会话加载棋谱成功', { sessionId });
    return session.data.sgf;
  }
  /**
   * 从 SGF 内容加载棋谱
   */
  loadFromSGF(sgf: string, options?: ReplayLoadOptions): ReplayData | null {
    const data = sgfToReplayData(sgf, options);
    if (!data) {
      // 用 SGFParser 重新解析，获取详细错误信息
      try {
        const parser = new SGFParser();
        const result = parser.parse(sgf);
        console.warn('SGF 解析失败', {
          errors: result.errors,
          sgfPrefix: sgf.slice(0, 500),
        });
      } catch (e) {
        console.warn('SGF 解析失败（无法获取详细错误）', {
          error: e instanceof Error ? e.message : String(e),
          sgfPrefix: sgf.slice(0, 500),
        });
      }
      return null;
    }
    // console.debug('棋谱加载成功', { gameName: data.game_name, maxMoves: data.max_moves });
    return data;
  }
  /**
   * 下载 SGF
   */
  async downloadSGF(sgf: string, gameName: string): Promise<ExportResult> {
    // console.debug('下载棋谱', { gameName });
    return this.exportService.exportSGF(sgf, gameName);
  }
  /**
   * 播放音效
   */
  playSound(type: SoundType): void {
    this.audioPlayer.play(type).catch(() => {
      // 音效播放失败，静默处理
    });
  }
  /**
   * 初始化音频（需要在用户手势中调用）
   */
  async initializeAudio(): Promise<void> {
    if ('initialize' in this.audioPlayer) {
      await (this.audioPlayer as any).initialize();
    }
  }
  /**
   * 切换音效
   */
  toggleSound(): boolean {
    const muted = this.audioPlayer.isMuted();
    this.audioPlayer.setMuted(!muted);
    // console.debug('音效切换', { muted: !muted });
    return !muted;
  }
  /**
   * 获取音效状态
   */
  isSoundMuted(): boolean {
    return this.audioPlayer.isMuted();
  }
}
