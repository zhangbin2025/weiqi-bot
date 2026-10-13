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
import type { IShareService } from '../../services/share';
import { parseSGF, coordToPos } from '../../domain/sgf';
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
    private readonly shareService?: IShareService,
  ) {}

  /**
   * 生成当前归档棋谱的分享链接
   *
   * 优先级：
   * 1. 归档记录的原始 URL 是 http(s)（野狐/OGS/101 等在线来源）→ 直接复用
   * 2. 原始 URL 是内置棋谱库 lib://... → 同样用该 URL 生成（内置库无需外链）
   * 3. 其余情况（archive: 本地归档、无 URL）→ 用 SGF 内容经 ShareService 编码成分享链接
   *
   * @returns 分享链接，无法生成时返回 null
   */
  async getShareUrl(archiveId: string): Promise<string | null> {
    const sourceUrl = await this.getArchiveUrl(archiveId);
    // 1&2. 在线来源 http(s) 与内置棋谱库 lib:// 都直接用原始 URL
    if (sourceUrl && /^(https?:\/\/|lib:\/\/)/i.test(sourceUrl)) {
      return sourceUrl;
    }
    // 3. 回退：用 SGF 内容编码
    return this.buildShareUrlFromSgf(archiveId);
  }

  /**
   * 用归档的 SGF 内容生成分享链接（无可用来源 URL 时的兜底）
   */
  private async buildShareUrlFromSgf(archiveId: string): Promise<string | null> {
    if (!this.gameService || !this.shareService) return null;
    const sgf = await this.gameService.getByArchiveId(archiveId);
    if (!sgf) return null;
    const parsed = parseSGF(sgf);
    if (parsed.moves.length === 0) return null;
    const moves = parsed.moves
      .map((m) => {
        const pos = coordToPos(m.coord);
        return pos ? { color: m.color === 'W' ? ('W' as const) : ('B' as const), x: pos.x, y: pos.y } : null;
      })
      .filter((m): m is { color: 'B' | 'W'; x: number; y: number } => m !== null);
    if (moves.length === 0) return null;
    return this.shareService.generateShareUrl(moves, parsed.gameInfo.boardSize, parsed.gameInfo.handicap);
  }
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
   * 获取归档的原始 URL（棋谱来源链接）
   */
  async getArchiveUrl(archiveId: string): Promise<string | null> {
    if (!this.gameService) return null;
    const index = await this.gameService.getArchiveIndex(archiveId);
    if (!index) return null;
    const url = (index.metadata as Record<string, unknown>)?.['url'] as string | undefined;
    return url ?? null;
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
