/**
 * ReplayPage 状态接口
 * @description 集中管理 ReplayPage 的所有状态字段
 */
import { Game } from '../../../../../../domain/game';
import type { ReplayData, ReplayNode } from '../../../../../../domain/sgf';
import type { MoveNumber } from '../../../../../core/helpers/BoardRebuilder';
export interface ReplayPageStateData {
  // 核心数据
  replayData: ReplayData | null;
  sgfContent: string | null;
  game: Game;
  // 导航状态
  currentPath: number[];
  displayIndex: number;
  // 功能开关
  showMoveNumbers: boolean;
  soundEnabled: boolean;
  // 分支状态
  savedPath: number[];
  savedDisplayIndex: number;
  savedShowMoveNumbers: boolean;
  inVariation: boolean;
  variationStartMove: number;
  // UI 状态
  initialized: boolean;
  moveNumbersList: MoveNumber[];
}
/**
 * ReplayPage 状态管理类
 */
export class ReplayPageState {
  private state: ReplayPageStateData;
  constructor() {
    this.state = {
      replayData: null,
      sgfContent: null,
      game: new Game(),
      currentPath: [],
      displayIndex: 0,
      showMoveNumbers: false,
      soundEnabled: true,
      savedPath: [],
      savedDisplayIndex: 0,
      savedShowMoveNumbers: false,
      inVariation: false,
      variationStartMove: 0,
      initialized: false,
      moveNumbersList: [],
    };
  }
  // 获取状态
  get<K extends keyof ReplayPageStateData>(key: K): ReplayPageStateData[K] {
    return this.state[key];
  }
  // 设置状态
  set<K extends keyof ReplayPageStateData>(key: K, value: ReplayPageStateData[K]): void {
    this.state[key] = value;
  }
  // 获取完整状态（只读）
  getState(): Readonly<ReplayPageStateData> {
    return this.state;
  }
  // 重置状态
  reset(): void {
    this.state.replayData = null;
    this.state.sgfContent = null;
    this.state.game = new Game();
    this.state.currentPath = [];
    this.state.displayIndex = 0;
    this.state.savedPath = [];
    this.state.savedDisplayIndex = 0;
    this.state.inVariation = false;
    this.state.variationStartMove = 0;
    this.state.moveNumbersList = [];
    this.state.initialized = false;
  }
  // 保存路径（进入分支前）
  savePath(): void {
    this.state.savedPath = [...this.state.currentPath];
    this.state.savedDisplayIndex = this.state.displayIndex;
    this.state.savedShowMoveNumbers = this.state.showMoveNumbers;
  }
  // 恢复路径（返回主分支）
  restorePath(): void {
    this.state.currentPath = [...this.state.savedPath];
    this.state.displayIndex = this.state.savedDisplayIndex;
    this.state.showMoveNumbers = this.state.savedShowMoveNumbers;
  }
  // 进入分支模式
  enterVariationMode(startMove: number): void {
    this.savePath();
    this.state.inVariation = true;
    this.state.variationStartMove = startMove;
  }
  // 退出分支模式
  exitVariationMode(): void {
    this.restorePath();
    this.state.inVariation = false;
    this.state.variationStartMove = 0;
  }
  // 计算当前手数
  getCurrentMoveNumber(): number {
    if (!this.state.replayData) return 0;
    let count = 0;
    let node = this.state.replayData.tree;
    for (const index of this.state.currentPath) {
      if (!node.children || node.children.length <= index) break;
      node = node.children[index]!;
      if (node.color) count++;
    }
    count += this.state.displayIndex;
    return count;
  }
  // 获取当前节点
  getCurrentNode(): ReplayNode | null {
    if (!this.state.replayData?.tree) return null;
    let node = this.state.replayData.tree;
    for (const index of this.state.currentPath) {
      if (!node.children || node.children.length <= index) return null;
      node = node.children[index]!;
    }
    for (let i = 0; i < this.state.displayIndex && node.children && node.children.length > 0; i++) {
      node = node.children[0]!;
    }
    return node;
  }
}
