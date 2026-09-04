/**
 * @fileoverview 101围棋网 SGF 生成器
 */

import type { GameMetadata } from '../base/types';
import type { Weiqi101QuestionData } from './Weiqi101Parser';

/**
 * 101围棋网 SGF 生成器
 *
 * 负责将棋谱数据转换为 SGF 格式。
 */
export class Weiqi101SgfGenerator {
  /**
   * 生成 SGF 内容（WebSocket 数据）
   */
  generate(posList: string[], metadata: GameMetadata): string {
    const parts: string[] = [];

    // 头部
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push('SZ[' + metadata.width + ']');
    parts.push('PB[' + metadata.blackName + ']');
    parts.push('PW[' + metadata.whiteName + ']');

    if (metadata.blackRank) {
      parts.push('BR[' + metadata.blackRank + ']');
    }
    if (metadata.whiteRank) {
      parts.push('WR[' + metadata.whiteRank + ']');
    }

    parts.push('KM[' + metadata.komi + ']');

    if (metadata.result) {
      parts.push('RE[' + metadata.result + ']');
    }

    // 规则
    const ruleCode = { chinese: 'CN', japanese: 'JP', korean: 'KO' }[
      metadata.rules
    ] || 'CN';
    parts.push('RU[' + ruleCode + ']');

    if (metadata.handicap > 0) {
      parts.push('HA[' + metadata.handicap + ']');
    }

    // 着法：pos 已经是 SGF 格式坐标
    for (let i = 0; i < posList.length; i++) {
      const pos = posList[i];
      if (pos === 'tt') continue; // 停一手

      const color = i % 2 === 0 ? 'B' : 'W';
      parts.push(';' + color + '[' + pos + ']');
    }

    parts.push(')');
    return parts.join('');
  }

  /**
   * 生成题目 SGF（包含所有答案分支）
   */
  generateQuestion(data: Weiqi101QuestionData): string {
    const parts: string[] = [];

    // 头部
    parts.push('(;GM[1]FF[4]CA[UTF-8]');
    parts.push('SZ[' + data.lu + ']');
    parts.push('PB[' + data.name + ']');
    parts.push('PW[' + data.levelname + ' ' + data.qtypename + ']');

    // 题目描述
    const desc = data.name + ' - ' + data.levelname + data.qtypename + ' - ' + (data.blackfirst ? '黑先' : '白先');
    parts.push('C[' + desc + ']');

    // 标注先手方（重要！）
    if (!data.blackfirst) {
      parts.push('PL[W]'); // 白先
    }
    // 黑先不需要标注，因为 PL[B] 是默认值

    // 初始局面
    const [blackStones, whiteStones] = data.content;
    blackStones.forEach(pos => parts.push('AB[' + pos + ']'));
    whiteStones.forEach(pos => parts.push('AW[' + pos + ']'));

    // 答案分支（每个答案是一个分支）
    // ty: 1=正解图, 2=变化图, 3=失败图（图的分类，决定分支名称）
    // st: 0=失败, 1=变招, 2=正解（答案结果状态）
    const typeMap: Record<number, string> = { 1: '正解图', 2: '变化图', 3: '失败图' };

    // 过滤待审核答案（st=1），只保留正式答案（st=2）
    const filteredAnswers = data.answers.filter(a => a.st !== 1);

    // 按类型排序：正解图 -> 变化图 -> 失败图，同类型按 nu 排序
    const sortedAnswers = [...filteredAnswers].sort((a, b) => {
      const typeOrder: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
      const ta = typeOrder[a.ty] ?? 99;
      const tb = typeOrder[b.ty] ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.nu ?? 0) - (b.nu ?? 0);
    });

    sortedAnswers.forEach(answer => {
      parts.push('\n('); // 开始分支
      const typeName = typeMap[answer.ty] || '未知';
      parts.push('C[' + typeName + (answer.username ? ' - ' + answer.username : '') + ']');

      // 着法序列
      answer.pts.forEach((move, i) => {
        // 根据谁先决定着法颜色
        // 如果黑先：第0步是黑(B)，第1步是白(W)，第2步是黑(B)...
        // 如果白先：第0步是白(W)，第1步是黑(B)，第2步是白(W)...
        const actualColor = data.blackfirst
          ? (i % 2 === 0 ? 'B' : 'W')
          : (i % 2 === 0 ? 'W' : 'B');
        parts.push(';' + actualColor + '[' + move.p + ']');
      });

      parts.push(')'); // 结束分支
    });

    parts.push(')');
    return parts.join('');
  }
}
