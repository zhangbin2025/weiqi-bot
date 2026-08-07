import type { MoveOrPass } from '../move';
import type { ISGFGameInfo } from './types';
import type { ISGFWriter, ISGFWriteOptions } from './ISGFWriter';
import { isPass } from '../move';
import { playerColorToSGFColor } from '../primitives';

/**
 * SGF 写入器实现
 * 将着法序列和对局信息转换为 SGF 格式
 * @ai-example
 * const writer = new SGFWriter();
 * const moves = [createMove(3, 3, 'black', 1), createMove(15, 15, 'white', 2)];
 * const sgf = writer.write(moves, { size: 19, blackName: '黑方' });
 */
export class SGFWriter implements ISGFWriter {
  private options: ISGFWriteOptions;

  constructor(options?: Partial<ISGFWriteOptions>) {
    this.options = {
      includeComments: options?.includeComments ?? false,
      newline: options?.newline ?? '\n',
    };
  }

  /**
   * 写入 SGF 文本
   */
  write(moves: readonly MoveOrPass[], info?: Partial<ISGFGameInfo>): string {
    const lines: string[] = [];
    const nl = this.options.newline;
    // 开始
    lines.push('(');
    // 根节点信息
    lines.push(';GM[1]FF[4]CA[UTF-8]');
    lines.push(`SZ[${info?.size ?? 19}]`);
    lines.push(`PB[${info?.blackName ?? '黑方'}]`);
    lines.push(`PW[${info?.whiteName ?? '白方'}]`);
    if (info?.komi !== undefined) {
      lines.push(`KM[${info.komi}]`);
    }
    if (info?.result) {
      lines.push(`RE[${info.result}]`);
    }
    if (info?.date) {
      lines.push(`DT[${info.date}]`);
    }
    // 写入让子棋（如果有）
    if (info?.handicapStones && info.handicapStones.length > 0) {
      const handicapText = this.writeHandicapStones(
        info.handicapStones.map(s => ({
          x: s.x,
          y: s.y,
          color: s.color === 'B' ? 'black' : 'white',
        }))
      );
      if (handicapText) {
        lines.push(handicapText);
      }
    }
    // 着法
    for (const move of moves) {
      const sgfColor = playerColorToSGFColor(move.color);
      if (isPass(move)) {
        lines.push(`;${sgfColor}[tt]`);
      } else {
        const coord = String.fromCharCode(97 + move.x) + String.fromCharCode(97 + move.y);
        lines.push(`;${sgfColor}[${coord}]`);
      }
    }
    // 结束
    lines.push(')');
    return lines.join(nl);
  }

  /**
   * 写入让子位置
   */
  writeHandicapStones(stones: readonly { x: number; y: number; color: 'black' | 'white' }[]): string {
    const blackStones = stones.filter((s) => s.color === 'black');
    const whiteStones = stones.filter((s) => s.color === 'white');
    const props: string[] = [];
    if (blackStones.length > 0) {
      const coords = blackStones.map((s) => String.fromCharCode(97 + s.x) + String.fromCharCode(97 + s.y));
      props.push(`AB[${coords.join('][')}]`);
    }
    if (whiteStones.length > 0) {
      const coords = whiteStones.map((s) => String.fromCharCode(97 + s.x) + String.fromCharCode(97 + s.y));
      props.push(`AW[${coords.join('][')}]`);
    }
    return props.join(this.options.newline);
  }
}