/**
 * 复盘变化图管理器
 * @module presentation/adapters/web/pages/review/ReviewVariationManager
 * 
 * 支持层层递进的试下模式：
 * - 基础棋谱 -> 试下变化图1 -> 试下变化图2 -> ...
 * - 每一层都可以AI推荐选点
 * - 点击推荐选点进入下一层变化图
 * - 支持层层回退
 */
import type { WebBoard } from '../../components/Board';
import { Game } from '../../../../../domain/game';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import type { PlayerColor } from '../../../../../domain/primitives';
/** 变化图层 */
export interface VariationLayer {
  /** 层级ID */
  id: string;
  /** 父层级ID（基础层为 null） */
  parentId: string | null;
  /** 层级深度（基础层为 0） */
  depth: number;
  /** 基础着法（进入这层时的棋盘状态） */
  baseMoves: Array<{ x: number; y: number; color: PlayerColor }>;
  /** 这层的试下着法 */
  trialMoves: Array<{ x: number; y: number; color: PlayerColor }>;
  /** 这层开始的当前手数 */
  startMoveNumber: number;
  /** 创建时间 */
  createdAt: number;
}
/** 变化图管理器配置 */
export interface VariationManagerConfig {
  board: WebBoard;
  game: Game;
  onLayerChange?: (layer: VariationLayer) => void;
}
/**
 * 变化图管理器
 */
export class VariationManager {
  private board: WebBoard;
  private game: Game;
  private onLayerChange?: (layer: VariationLayer) => void;
  /** 所有层级的映射 */
  private layers = new Map<string, VariationLayer>();
  /** 当前层级 */
  private currentLayer: VariationLayer | null = null;
  /** 层级计数器 */
  private layerCounter = 0;
  /** 基础着法（原始棋谱） */
  private originalMoves: Array<{ x: number; y: number; color: PlayerColor }> = [];
  /** 重做栈 */
  private redoStack: Array<{ x: number; y: number; color: PlayerColor }> = [];
  /** 让子棋 */
  private handicapStones: Array<{ x: number; y: number; color: PlayerColor }> = [];
  constructor(config: VariationManagerConfig) {
    this.board = config.board;
    this.game = config.game;
    if (config.onLayerChange) {
      this.onLayerChange = config.onLayerChange;
    }
  }
  /**
   * 初始化基础层
   */
  initializeBaseLayer(moves: Array<{ x: number; y: number; color: PlayerColor }>, handicapStones?: Array<{ x: number; y: number; color: PlayerColor }>): void {
    this.originalMoves = [...moves];
    this.handicapStones = handicapStones ?? [];
    const baseLayer: VariationLayer = {
      id: 'base',
      parentId: null,
      depth: 0,
      baseMoves: [],
      trialMoves: [],
      startMoveNumber: 0,
      createdAt: Date.now(),
    };
    this.layers.set('base', baseLayer);
    this.currentLayer = baseLayer;
  }
  /**
   * 进入试下模式（创建新层级）
   */
  enterTrial(
    currentMoveNumber: number,
    currentMoves: Array<{ x: number; y: number; color: PlayerColor }>
  ): VariationLayer {
    if (!this.currentLayer) {
      throw new Error('未初始化基础层');
    }
    this.layerCounter++;
    const layerId = `layer_${this.layerCounter}`;
    const depth = this.currentLayer.depth + 1;
    // 新层级的基础着法 = 当前层级的完整着法
    const baseMoves = this.currentLayer.depth === 0
      ? currentMoves.slice(0, currentMoveNumber)
      : [...this.currentLayer.baseMoves, ...this.currentLayer.trialMoves];
    const newLayer: VariationLayer = {
      id: layerId,
      parentId: this.currentLayer.id,
      depth,
      baseMoves,
      trialMoves: [],
      startMoveNumber: currentMoveNumber,
      createdAt: Date.now(),
    };
    this.layers.set(layerId, newLayer);
    this.currentLayer = newLayer;
    this.onLayerChange?.(newLayer);
    return newLayer;
  }
  /**
   * 添加试下着法
   */
  addTrialMove(x: number, y: number, color: PlayerColor): void {
    if (!this.currentLayer || this.currentLayer.depth === 0) {
      return;
    }
    this.redoStack = [];  // 清空重做栈（新分支）
    this.currentLayer.trialMoves.push({ x, y, color });
    this.rebuildBoard();
  }
  /**
   * 撤销着法（当前层级）
   */
  undo(): void {
    if (!this.currentLayer) return;
    if (this.currentLayer.trialMoves.length > 0) {
      const move = this.currentLayer.trialMoves.pop()!;
      this.redoStack.push(move);  // 保存到重做栈
      this.rebuildBoard();
    }
  }
  /**
   * 重做着法（当前层级）
   */
  redo(): void {
    if (!this.currentLayer) return;
    if (this.redoStack.length > 0) {
      const move = this.redoStack.pop()!;
      this.currentLayer.trialMoves.push(move);
      this.rebuildBoard();
    }
  }
  /**
   * 回退到上一层级
   */
  backToParent(): VariationLayer | null {
    if (!this.currentLayer || !this.currentLayer.parentId) {
      return null;
    }
    const parentLayer = this.layers.get(this.currentLayer.parentId);
    if (!parentLayer) {
      console.error('父层级不存在');
      return null;
    }
    // 删除当前层级
    this.layers.delete(this.currentLayer.id);
    this.currentLayer = parentLayer;
    // 重建棋盘
    this.rebuildBoard();
    this.onLayerChange?.(parentLayer);
    return parentLayer;
  }
  /**
   * 回退到指定层级
   */
  backToLayer(layerId: string): VariationLayer | null {
    const targetLayer = this.layers.get(layerId);
    if (!targetLayer) {
      console.error(`层级 ${layerId} 不存在`);
      return null;
    }
    // 删除所有子层级
    this.deleteChildLayers(layerId);
    this.currentLayer = targetLayer;
    this.rebuildBoard();
    this.onLayerChange?.(targetLayer);
    return targetLayer;
  }
  /**
   * 退出试下模式（回到基础层）
   */
  exitTrial(): { moveNumber: number } {
    if (!this.currentLayer) {
      return { moveNumber: 0 };
    }
    const startMoveNumber = this.currentLayer.startMoveNumber;
    // 删除所有试下层级
    this.deleteAllTrialLayers();
    // 回到基础层
    const baseLayer = this.layers.get('base');
    if (baseLayer) {
      this.currentLayer = baseLayer;
    }
    this.rebuildBoard();
    this.onLayerChange?.(this.currentLayer!);
    return { moveNumber: startMoveNumber };
  }
  /**
   * 获取当前层级
   */
  getCurrentLayer(): VariationLayer | null {
    return this.currentLayer;
  }
  /**
   * 获取当前层级的完整着法
   */
  getCurrentMoves(): Array<{ x: number; y: number; color: PlayerColor }> {
    if (!this.currentLayer) return [];
    return [
      ...this.currentLayer.baseMoves,
      ...this.currentLayer.trialMoves,
    ];
  }
  /**
   * 是否在试下模式
   */
  isInTrial(): boolean {
    return this.currentLayer !== null && this.currentLayer.depth > 0;
  }
  /**
   * 获取层级深度
   */
  getDepth(): number {
    return this.currentLayer?.depth ?? 0;
  }
  /**
   * 获取所有层级路径
   */
  getLayerPath(): VariationLayer[] {
    const path: VariationLayer[] = [];
    if (!this.currentLayer) return path;
    let layer: VariationLayer | null = this.currentLayer;
    while (layer) {
      path.unshift(layer);
      layer = layer.parentId ? this.layers.get(layer.parentId) ?? null : null;
    }
    return path;
  }
  /**
   * 重建棋盘
   */
  private rebuildBoard(): void {
    if (!this.currentLayer) return;
    const allMoves = this.getCurrentMoves();
    
    // 重置棋局
    this.game.newGame({ size: 19 });
    
    // 设置让子棋（使用Game.setHandicapStones方法）
    if (this.handicapStones.length > 0) {
      const handicapStones = this.handicapStones.map(stone => ({
        x: stone.x,
        y: stone.y,
        color: stone.color === 'black' ? 'B' as const : 'W' as const
      }));
      this.game.setHandicapStones(handicapStones);
    }
    
    // 放置所有着法
    for (const move of allMoves) {
      this.game.placeStone(move.x, move.y);
    }
    
    // 同步到棋盘显示
    BoardSyncer.sync(this.board, this.game, [], false);
  }
  /**
   * 删除所有子层级
   */
  private deleteChildLayers(parentId: string): void {
    const childLayers: string[] = [];
    this.layers.forEach((layer, id) => {
      if (layer.parentId === parentId) {
        childLayers.push(id);
        // 递归删除
        this.deleteChildLayers(id);
      }
    });
    childLayers.forEach(id => this.layers.delete(id));
  }
  /**
   * 删除所有试下层级
   */
  private deleteAllTrialLayers(): void {
    const trialLayerIds: string[] = [];
    this.layers.forEach((layer, id) => {
      if (layer.depth > 0) {
        trialLayerIds.push(id);
      }
    });
    trialLayerIds.forEach(id => this.layers.delete(id));
  }
  /**
   * 销毁
   */
  destroy(): void {
    this.layers.clear();
    this.currentLayer = null;
    this.originalMoves = [];
    this.layerCounter = 0;
  }
}