import type { ICoordinate } from './ICoordinate';
import type { ICoordinateConverter } from './ICoordinateConverter';
import { createCoordinate } from './ICoordinate';

/**
 * 坐标转换器实现
 * 支持 SGF、数字、显示坐标之间的转换
 * @ai-example
 * const converter = new CoordinateConverter(19);
 * converter.sgfToCoordinate('pd'); // { x: 15, y: 3 }
 * converter.coordinateToSGF({ x: 3, y: 3 }); // 'dd'
 * converter.coordinateToDisplay({ x: 3, y: 3 }); // 'D16'
 */
export class CoordinateConverter implements ICoordinateConverter {
  readonly boardSize: number;

  constructor(boardSize: number = 19) {
    this.boardSize = boardSize;
  }

  /**
   * SGF 坐标转数字坐标
   * SGF 使用 'a'-'s' 表示 0-18
   * @param sgf - SGF 坐标（如 'dd'）
   * @returns 数字坐标 {x, y}
   */
  sgfToCoordinate(sgf: string): ICoordinate {
    if (!sgf || sgf.length !== 2) {
      throw new Error(`Invalid SGF coordinate: ${sgf}`);
    }
    const x = sgf.charCodeAt(0) - 97;
    const y = sgf.charCodeAt(1) - 97;
    return createCoordinate(x, y);
  }

  /**
   * 数字坐标转 SGF 坐标
   * @param coord - 数字坐标 {x, y}
   * @returns SGF 坐标（如 'dd'）
   */
  coordinateToSGF(coord: ICoordinate): string {
    return String.fromCharCode(97 + coord.x) + String.fromCharCode(97 + coord.y);
  }

  /**
   * 数字坐标转显示坐标
   * 列用字母 A-T（跳过 I），行用数字从上往下
   * @param coord - 数字坐标 {x, y}
   * @returns 显示坐标（如 'D16'）
   */
  coordinateToDisplay(coord: ICoordinate): string {
    // 列字母：跳过 I（A-H, J-T）
    const colLetter = String.fromCharCode(
      65 + coord.x + (coord.x >= 8 ? 1 : 0)
    );
    // 行号：从上往下计数（19路棋盘：y=0 → 第19行）
    const rowNumber = this.boardSize - coord.y;
    return `${colLetter}${rowNumber}`;
  }

  /**
   * 显示坐标转数字坐标
   * @param display - 显示坐标（如 'D16'）
   * @returns 数字坐标或 null（无效格式）
   */
  displayToCoordinate(display: string): ICoordinate | null {
    if (!display || display.length < 2) return null;
    // 解析列字母
    const colLetter = display.charAt(0).toUpperCase();
    const colIndex = colLetter.charCodeAt(0) - 65;
    // 跳过 I
    const x = colIndex >= 8 ? colIndex - 1 : colIndex;
    if (x < 0 || x >= this.boardSize) return null;
    // 解析行号
    const rowStr = display.slice(1);
    const row = parseInt(rowStr, 10);
    if (isNaN(row) || row < 1 || row > this.boardSize) return null;
    const y = this.boardSize - row;
    return createCoordinate(x, y);
  }

  /**
   * 批量转换 SGF 坐标到数字坐标
   * @param sgfCoords - SGF 坐标列表
   * @returns 数字坐标列表
   */
  batchSGFToCoordinates(sgfCoords: string[]): ICoordinate[] {
    return sgfCoords.map((sgf) => this.sgfToCoordinate(sgf));
  }

  /**
   * 批量转换数字坐标到 SGF 坐标
   * @param coords - 数字坐标列表
   * @returns SGF 坐标列表
   */
  batchCoordinatesToSGF(coords: ICoordinate[]): string[] {
    return coords.map((coord) => this.coordinateToSGF(coord));
  }
}