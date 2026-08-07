/**
 * @fileoverview 手谈 YAML 数据解析器
 */

import type { ShoutanGameData } from './types';

/**
 * 解析结果
 */
export interface ParsedGameData {
  gameInfo: {
    blackName: string;
    whiteName: string;
    boardSize: string;
    event?: string;
    date?: string;
    resultSgf?: string;
  };
  moves: Array<{ color: string; coord: string }>;
}

/**
 * 解析 YAML 格式的棋谱数据
 */
export function parseYamlData(data: ShoutanGameData): ParsedGameData {
  const ymlContent = data.yml || '';
  const gameInfo = {
    blackName: data.black?.name || '黑棋',
    whiteName: data.white?.name || '白棋',
    boardSize: '19',
    ...(data.event ? { event: data.event } : {}),
    ...(data.date ? { date: data.date } : {}),
    resultSgf: '',
  };

  const moves: Array<{ color: string; coord: string }> = [];
  const lines = ymlContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- SZ:')) {
      gameInfo.boardSize = trimmed.split(':')[1]?.trim() || '19';
    } else if (trimmed.startsWith('- PB:')) {
      gameInfo.blackName = trimmed.split(':')[1]?.trim() || gameInfo.blackName;
    } else if (trimmed.startsWith('- PW:')) {
      gameInfo.whiteName = trimmed.split(':')[1]?.trim() || gameInfo.whiteName;
    } else if (trimmed.startsWith('- EV:')) {
      if (trimmed.split(':')[1]?.trim()) gameInfo.event = trimmed.split(':')[1]!.trim();
    } else if (trimmed.startsWith('- DT:')) {
      if (trimmed.split(':')[1]?.trim()) gameInfo.date = trimmed.split(':')[1]!.trim();
    } else if (trimmed.startsWith('- RE:')) {
      gameInfo.resultSgf = trimmed.split(':')[1]?.trim() ?? '';
    } else if (trimmed.startsWith('- B:')) {
      moves.push({ color: 'B', coord: trimmed.replace('- B:', '').trim() });
    } else if (trimmed.startsWith('- W:')) {
      moves.push({ color: 'W', coord: trimmed.replace('- W:', '').trim() });
    }
  }

  // 处理中文结果
  if (!gameInfo.resultSgf && data.result) {
    const resultMap: Record<string, string> = {
      '黑中盘胜': 'B+R',
      '白中盘胜': 'W+R',
      '黑胜': 'B+',
      '白胜': 'W+',
    };
    gameInfo.resultSgf = resultMap[data.result] || data.result;
  }

  return { gameInfo, moves };
}

/**
 * 生成 SGF 内容
 */
export function generateSgf(
  info: ParsedGameData['gameInfo'],
  moves: Array<{ color: string; coord: string }>
): string {
  const parts: string[] = [];
  parts.push('(;GM[1]FF[4]CA[UTF-8]');
  parts.push(`SZ[${info.boardSize}]`);
  parts.push('AP[GoStarV7]');
  parts.push(`PB[${info.blackName}]`);
  parts.push(`PW[${info.whiteName}]`);

  if (info.event) parts.push(`EV[${info.event}]`);
  if (info.date) parts.push(`DT[${info.date}]`);
  if (info.resultSgf) parts.push(`RE[${info.resultSgf}]`);

  parts.push('SO[丹朱对局集]');

  for (const move of moves) {
    parts.push(`;${move.color}[${move.coord}]`);
  }

  parts.push(')');
  return parts.join('');
}