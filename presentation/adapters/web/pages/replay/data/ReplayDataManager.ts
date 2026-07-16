/**
 * ReplayPage 数据管理器
 * @description 负责数据加载、初始化和转换
 */
import type { WebBoard } from '../../../components/Board';
import type { ReplayApp } from '../../../../../../application/replay';
import type { ReplayData, ReplayNode } from '../../../../../../domain/sgf';
import type { ReplayPageState } from '../state/ReplayPageState';
import type { MoveNavigator } from '../../../../../core/controllers';
export class ReplayDataManager {
  constructor(
    private state: ReplayPageState,
    private replayApp: ReplayApp,
    private board: WebBoard,
    private moveNavigator: MoveNavigator
  ) {}
  /**
   * 从 SGF 内容加载
   */
  loadFromSGF(sgf: string, options?: { defaultMove?: number }): void {
    const data = this.replayApp.loadFromSGF(sgf, options);
    if (data) {
      this.state.set('sgfContent', sgf);
      this.state.set('replayData', data);
      this.initBoard();
    }
  }
  /**
   * 从归档 ID 加载
   */
  async loadByArchiveId(archiveId: string): Promise<string | null> {
    try {
      const sgfContent = await this.replayApp.loadByArchiveId(archiveId);
      if (sgfContent) {
        this.state.set('sgfContent', sgfContent);
        const data = this.replayApp.loadFromSGF(sgfContent);
        if (data) {
          this.state.set('replayData', data);
          this.initBoard();
        }
      }
      return sgfContent;
    } catch (error) {
      console.error('归档加载失败:', error);
      return null;
    }
  }
  /**
   * 设置数据
   */
  setData(data: ReplayData): void {
    this.state.set('replayData', data);
    this.initBoard();
  }
  /**
   * 处理 URL 参数
   */
  handleParams(params: Record<string, string>): void {
    if (params['sgf']) {
      try {
        const base64Str = params['sgf'] as string;
        const sgfContent = decodeURIComponent(escape(atob(base64Str)));
        this.loadFromSGF(sgfContent);
      } catch (e) {
        console.error('SGF 参数解析失败:', e);
      }
    }
  }
  /**
   * 初始化棋盘
   */
  initBoard(): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    const size = replayData.board_size as 9 | 13 | 19;
    this.board.initialize({ size, showCoordinates: true });
    this.board.clear();
    // 更新控制器
    const maxMoves = replayData.max_moves || this.countMaxMoves(replayData.tree);
    this.moveNavigator.setMaxMoves(maxMoves);
    // 跳转到默认手数
    const defaultMove = replayData.default_move || 0;
    if (defaultMove > 0) {
      this.moveNavigator.goTo(Math.min(defaultMove, maxMoves));
    } else {
      // 触发显示更新
      this.moveNavigator.goTo(0);
    }
  }
  /**
   * 翻译胜负结果
   */
  translateResult(result: string): string {
    if (!result) return '';
    result = result.trim();
    if (result === 'B+R' || result === 'B+Resign') return '黑中盘胜';
    if (result === 'W+R' || result === 'W+Resign') return '白中盘胜';
    if (result === 'B+T' || result === 'B+Time') return '黑超时胜';
    if (result === 'W+T' || result === 'W+Time') return '白超时胜';
    const match = result.match(/^B\+(\d+\.?\d*)$/);
    if (match) return '黑胜' + match[1] + '目';
    const matchW = result.match(/^W\+(\d+\.?\d*)$/);
    if (matchW) return '白胜' + matchW[1] + '目';
    return result;
  }
  /**
   * 计算最大手数（只计算主分支）
   */
  countMaxMoves(node: ReplayNode): number {
    if (!node) return 0;
    let count = node.color ? 1 : 0;
    if (node.children && node.children.length > 0) {
      count += this.countMaxMoves(node.children[0]!);
    }
    return count;
  }
}
