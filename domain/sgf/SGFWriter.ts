import type { MoveOrPass } from '../move';
import type { ISGFGameInfo, ISGFNode, SGFProperties, SGFPropValue } from './types';
import type { ISGFWriter, ISGFWriteOptions, ISGFPropertySerializeOptions } from './ISGFWriter';
import { isPass } from '../move';
import { playerColorToSGFColor } from '../primitives';

/**
 * SGF 写入器实现
 * 将着法序列和对局信息转换为 SGF 格式
 *
 * 支持两种模式：
 * - write(): 线性着法序列 → SGF
 * - writeTree(): 树状节点 → SGF（保留分支结构）
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
   * 写入 SGF 文本（线性着法）
   */
  write(moves: readonly MoveOrPass[], info?: Partial<ISGFGameInfo>): string {
    const lines: string[] = [];
    const nl = this.options.newline;

    // 开始
    lines.push('(');
    lines.push(';GM[1]FF[4]CA[UTF-8]');
    lines.push('SZ[' + (info?.size ?? 19) + ']');
    lines.push('PB[' + (info?.blackName ?? '黑方') + ']');
    lines.push('PW[' + (info?.whiteName ?? '白方') + ']');

    if (info?.komi !== undefined) {
      lines.push('KM[' + info.komi + ']');
    }
    if (info?.result) {
      lines.push('RE[' + info.result + ']');
    }
    if (info?.date) {
      lines.push('DT[' + info.date + ']');
    }
    if (info?.application) {
      lines.push('AP[' + info.application + ']');
    }
    if (info?.blackRank) {
      lines.push('BR[' + info.blackRank + ']');
    }
    if (info?.whiteRank) {
      lines.push('WR[' + info.whiteRank + ']');
    }
    if (info?.event) {
      lines.push('EV[' + info.event + ']');
    }
    if (info?.source) {
      lines.push('SO[' + info.source + ']');
    }

    // 写入让子数（如果有）
    if (info?.handicap && info.handicap > 0) {
      lines.push('HA[' + info.handicap + ']');
    }

    // 写入让子棋位置（如果有）
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

    // 写入先手方（如果有）
    if (info?.initialPlayer) {
      const plValue = info.initialPlayer === 'black' ? 'B' : 'W';
      lines.push('PL[' + plValue + ']');
    }

    // 着法
    for (const move of moves) {
      const sgfColor = playerColorToSGFColor(move.color);
      if (isPass(move)) {
        lines.push(';' + sgfColor + '[tt]');
      } else {
        const coord = String.fromCharCode(97 + move.x) + String.fromCharCode(97 + move.y);
        lines.push(';' + sgfColor + '[' + coord + ']');
      }
    }

    // 结束
    lines.push(')');
    return lines.join(nl);
  }

  /**
   * 写入 SGF 文本（树状结构，保留分支）
   * 从根节点递归序列化整棵树
   *
   * @param node - SGF 节点树
   * @param serializeOptions - 属性过滤选项（可选）
   * @returns SGF 文本
   */
  writeTree(
    node: ISGFNode,
    serializeOptions?: ISGFPropertySerializeOptions
  ): string {
    return '(' + this.serializeNode(node, true, serializeOptions) + ')';
  }

  /**
   * 序列化单个节点及其子树
   */
  private serializeNode(
    node: ISGFNode,
    isRoot: boolean,
    opts?: ISGFPropertySerializeOptions
  ): string {
    let s = ';';

    // 序列化属性
    const props = node.properties || {};
    for (const key of Object.keys(props)) {
      // 应用白名单/黑名单过滤
      if (opts?.whitelist && !opts.whitelist.has(key)) continue;
      if (opts?.blacklist && opts.blacklist.has(key)) continue;

      const value = props[key];
      if (value === undefined) continue;
      s += this.serializeProperty(key, value);
    }

    // 序列化子节点
    const children = node.children || [];
    if (children.length === 0) {
      return s;
    }

    if (children.length === 1) {
      // 单子节点：直接拼接
      const child = children[0];
      if (child === undefined) return s;
      return s + this.serializeNode(child, false, opts);
    }

    // 多子节点：每个子节点用 () 包裹
    let result = s;
    for (const child of children) {
      result += '(' + this.serializeNode(child, false, opts) + ')';
    }
    return result;
  }

  /**
   * 序列化单个属性
   */
  private serializeProperty(key: string, value: SGFPropValue): string {
    if (Array.isArray(value)) {
      // 多值属性：KEY[v1][v2][v3]
      let s = key;
      for (const v of value) {
        s += '[' + this.escapeValue(v) + ']';
      }
      return s;
    }
    // 单值属性
    return key + '[' + this.escapeValue(String(value)) + ']';
  }

  /**
   * 转义 SGF 属性值中的特殊字符
   * ] → \]
   * \ → \\
   */
  private escapeValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]');
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
      props.push('AB[' + coords.join('][') + ']');
    }
    if (whiteStones.length > 0) {
      const coords = whiteStones.map((s) => String.fromCharCode(97 + s.x) + String.fromCharCode(97 + s.y));
      props.push('AW[' + coords.join('][') + ']');
    }

    return props.join(this.options.newline);
  }
}
