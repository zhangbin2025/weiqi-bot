/**
 * @fileoverview RecorderService 主服务实现
 */

import type { IGameState, IMoveResult, IGameConfig } from '../../domain/game';
import { Game } from '../../domain/game';
import { SGFWriter, SGFParser } from '../../domain/sgf';
import type { IRecorderService } from './IRecorderService';
import type { IGameMetadata, OnUpdateCallback, IDraft } from './types';
import type { IKeyValueStorage } from '../../infrastructure/storage/interfaces';

/** 草稿存储键 */
const DRAFT_KEY = 'recorder:draft';

/**
 * 记谱编排服务
 * @description 管理游戏实例、处理UI交互、生成SGF、保存草稿
 */
export class RecorderService implements IRecorderService {
  private game: Game;
  private storage: IKeyValueStorage;
  private onUpdateCallback: OnUpdateCallback | null = null;
  private writer: SGFWriter;
  private parser: SGFParser;

  constructor(storage: IKeyValueStorage) {
    this.game = new Game();
    this.writer = new SGFWriter();
    this.parser = new SGFParser();
    this.storage = storage;
  }

  // ===== 游戏管理 =====

  placeStone(x: number, y: number): IMoveResult {
    const result = this.game.placeStone(x, y);
    if (result.success) {
      this.notifyUpdate();
    }
    return result;
  }

  pass(): void {
    this.game.pass();
    this.notifyUpdate();
  }

  undo(): boolean {
    const result = this.game.undo();
    if (result) {
      this.notifyUpdate();
    }
    return result;
  }

  newGame(config?: IGameConfig): void {
    this.game.newGame(config);
    this.notifyUpdate();
  }

  getState(): IGameState {
    return this.game.getState();
  }

  // ===== SGF 生成 =====

  generateSGF(metadata?: IGameMetadata): string {
    const state = this.game.getState();
    const sgfMeta: Parameters<typeof this.writer.write>[1] = {
      size: state.board.size,
      blackName: metadata?.blackName ?? '黑方',
      whiteName: metadata?.whiteName ?? '白方',
      komi: state.komi,
      handicap: state.handicap,
      date: metadata?.date ?? new Date().toISOString().slice(0, 10),
    };
    Object.assign(sgfMeta, { ...sgfMeta, ...(metadata?.result ? { result: metadata.result } : {}), ...(metadata?.rules ? { rules: metadata.rules } : {}) })
    return this.writer.write(state.moveHistory, sgfMeta);
  }

  // ===== 草稿管理 =====

  async saveDraft(): Promise<void> {
    const draft: IDraft = {
      sgf: this.generateSGF(),
      state: this.game.getState(),
    };
    await this.storage.write(DRAFT_KEY, draft);
  }

  async loadDraft(): Promise<void> {
    const draft = await this.storage.read<IDraft>(DRAFT_KEY);
    if (!draft) return;

    const result = this.parser.parse(draft.sgf);
    const info = result.gameInfo;
    this.game.newGame({
      size: info.boardSize,
      komi: parseFloat(info.komi) || 6.5,
      handicap: info.handicap,
    });

    for (const move of result.moves) {
      const coord = move.coord;
      // Pass move: 'tt' for 19x19, or empty
      if (coord === 'tt' || coord === '' || !coord) {
        this.game.pass();
      } else {
        const x = coord.charCodeAt(0) - 97;
        const y = coord.charCodeAt(1) - 97;
        this.game.placeStone(x, y);
      }
    }

    this.notifyUpdate();
  }

  async clearDraft(): Promise<void> {
    await this.storage.delete(DRAFT_KEY);
  }

  // ===== 回调通知 =====

  setOnUpdate(callback: OnUpdateCallback): void {
    this.onUpdateCallback = callback;
  }

  // ===== 私有方法 =====

  private notifyUpdate(): void {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.game.getState());
    }
  }
}
