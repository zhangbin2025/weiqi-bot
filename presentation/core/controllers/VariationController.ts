/**
 * 分支选择控制器
 * 负责管理棋谱的分支变化图
 * @module presentation/core/controllers/VariationController
 */
/** 变化图分支 */
export interface Variation {
  index: number;
  label: string;
  color: 'B' | 'W' | null;
  properties?: {
    N?: string | undefined;  // 标签
    C?: string | undefined;  // 注释
    [key: string]: string | undefined;
  } | undefined;
}
/** 分支选择配置 */
export interface VariationControllerConfig {
  /** 选择分支回调 */
  onSelect?: (index: number) => void;
  /** 返回上级回调 */
  onBackToParent?: () => void;
}
/**
 * 分支选择控制器
 * 适用场景：复盘、定式探索
 */
export class VariationController {
  private variations: Variation[] = [];
  private selectedIndex: number = 0;
  private onSelect?: ((index: number) => void) | undefined;
  private onBackToParent?: (() => void) | undefined;
  private parentPath: number[] = [];
  constructor(config: VariationControllerConfig = {}) {
    this.onSelect = config.onSelect;
    this.onBackToParent = config.onBackToParent;
  }
  /** 设置分支列表 */
  setVariations(variations: Variation[]): void {
    this.variations = variations;
    this.selectedIndex = 0;
  }
  /** 从节点子列表构建分支 */
  buildFromChildren(children: Array<{
    color: 'B' | 'W' | null;
    properties?: Variation['properties'];
  }>): void {
    this.variations = [];
    // 跳过第一个子节点（主分支），只保留变化图
    for (let i = 1; i < children.length; i++) {
      const child = children[i];
      const label = this.extractLabel(child!, i);
      this.variations.push({
        index: i,
        label,
        color: child!.color,
        properties: child!.properties as Variation['properties'],
      });
    }
    this.selectedIndex = 0;
  }
  /** 提取分支标签 */
  private extractLabel(child: { color: 'B' | 'W' | null; properties?: Variation['properties'] }, index: number): string {
    // 优先使用 N 属性
    if (child.properties?.N) {
      return child.properties.N;
    }
    // 尝试从注释中提取胜率
    if (child.properties?.C) {
      const winRate = this.extractWinRate(child.properties.C);
      if (winRate) return winRate;
    }
    // 默认标签
    return '变化' + index;
  }
  /** 从注释中提取胜率 */
  private extractWinRate(comment: string): string | null {
    const match = comment.match(/jueyi(黑|白)(\d+\.?\d*)%/);
    if (match) {
      return match[1] + ' ' + match[2] + '%';
    }
    return null;
  }
  /** 选择分支 */
  select(index: number): void {
    if (index >= 0 && index < this.variations.length) {
      this.selectedIndex = index;
      const variation = this.variations[index];
      this.onSelect?.(variation!.index);
    }
  }
  /** 返回上级 */
  backToParent(): void {
    this.onBackToParent?.();
  }
  /** 获取选中的分支 */
  getSelected(): Variation | null {
    return this.variations[this.selectedIndex] || null;
  }
  /** 获取所有分支 */
  getVariations(): Variation[] {
    return this.variations;
  }
  /** 是否有分支 */
  hasVariations(): boolean {
    return this.variations.length > 0;
  }
  /** 设置父路径（用于返回上级） */
  setParentPath(path: number[]): void {
    this.parentPath = [...path];
  }
  /** 获取父路径 */
  getParentPath(): number[] {
    return [...this.parentPath];
  }
  /** 清空分支 */
  clear(): void {
    this.variations = [];
    this.selectedIndex = 0;
    this.parentPath = [];
  }
  /** 重置选择 */
  reset(): void {
    this.selectedIndex = 0;
  }
}
