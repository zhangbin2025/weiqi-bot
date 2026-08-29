/**
 * @fileoverview RecorderService 主服务实现
 */

import type { IGameState, IMoveResult, IGameConfig } from '../../domain/game';
import type { PlayerColor } from '../../domain/primitives';
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

  // ===== 摆子模式 =====

  addInitialStone(x: number, y: number, color: 'B' | 'W'): boolean {
    const result = this.game.addInitialStone(x, y, color);
    if (result) {
      this.notifyUpdate();
    }
    return result;
  }

  removeInitialStone(x: number, y: number): boolean {
    const result = this.game.removeInitialStone(x, y);
    if (result) {
      this.notifyUpdate();
    }
    return result;
  }

  setInitialPlayer(player: PlayerColor): void {
    this.game.setInitialPlayer(player);
    this.notifyUpdate();
  }

  // ===== SGF 生成 =====

  generateSGF(metadata?: IGameMetadata): string {
    const state = this.game.getState();
    const sgfMeta = {
      size: state.board.size,
      blackName: metadata?.blackName ?? '黑方',
      whiteName: metadata?.whiteName ?? '白方',
      komi: state.komi,
      handicap: state.handicap,
      date: metadata?.date ?? new Date().toISOString().slice(0, 10),
      handicapStones: state.initialStones.length > 0 ? [...state.initialStones] : undefined,
      initialPlayer: state.initialPlayer,
      result: metadata?.result,
      rules: metadata?.rules,
    };
    return this.writer.write(state.moveHistory, sgfMeta);
  }

  // ===== 草稿管理 =====

  async saveDraft(mode: 'play' | 'setup' = 'play'): Promise<void> {
    const draft: IDraft = {
      sgf: this.generateSGF(),
      state: this.game.getState(),
      mode: mode,
    };
    await this.storage.write(DRAFT_KEY, draft);
  }

  async loadDraft(): Promise<{ mode: 'play' | 'setup' } | undefined> {
    const draft = await this.storage.read<IDraft>(DRAFT_KEY);
    if (!draft) return undefined;

    const result = this.parser.parse(draft.sgf);
    const info = result.gameInfo;
    
    const config: IGameConfig = {
      size: info.boardSize,
      komi: parseFloat(info.komi) || 6.5,
      handicap: info.handicap,
    };
    
    if (info.initialPlayer) {
      Object.assign(config, { initialPlayer: info.initialPlayer });
    }
    
    this.game.newGame(config);

    // 恢复 initialStones
    for (const stone of info.handicapStones) {
      this.game.addInitialStone(stone.x, stone.y, stone.color);
    }

    // 重放着法，确保颜色匹配
    for (const move of result.moves) {
      const coord = move.coord;
      if (coord === 'tt' || coord === '' || !coord) {
        this.game.pass();
      } else {
        const x = coord.charCodeAt(0) - 97;
        const y = coord.charCodeAt(1) - 97;
        
        // 确保 currentPlayer 与着法颜色匹配
        const expectedPlayer = move.color === 'B' ? 'black' : 'white';
        const state = this.game.getState();
        
        if (state.currentPlayer !== expectedPlayer) {
          (this.game as any).currentPlayer = expectedPlayer;
        }
        
        this.game.placeStone(x, y);
      }
    }

    this.notifyUpdate();

    // 返回保存的模式
    return { mode: draft.mode || 'play' };
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
