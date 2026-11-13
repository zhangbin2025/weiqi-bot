/**
 * 从原始对阵派生的辅助数据
 * @module domain/ranking/MatchDerived
 *
 * 对手弹窗、对阵卡片上的积分、对手名次都不属于排名表字段。
 * 内置实现与插件实现共用这些纯函数，避免为了养活周边功能
 * 而额外保留一份「内置排名结果」，造成两份真相。
 */

import type { MatchData, PlayerGame, RankingTable } from './types';

/** 列出某选手逐轮对局（含轮空），供对手弹窗使用 */
export function buildPlayerGames(matches: MatchData[], name: string, totalRounds?: number): PlayerGame[] {
  if (!matches.length) return [];
  const rounds = totalRounds ?? Math.max(...matches.map((m) => m.bout));
  const games: PlayerGame[] = [];
  for (let bout = 1; bout <= rounds; bout++) {
    const match = matches.find((m) => m.bout === bout && (m.p1Name === name || m.p2Name === name));
    if (!match) {
      games.push({ bout, opponentName: '', result: 'bye', color: 'black' });
      continue;
    }
    const isBlack = match.p1Name === name;
    const opponentName = isBlack ? match.p2Name : match.p1Name;
    const s1 = match.p1Score ?? 0, s2 = match.p2Score ?? 0;
    const myScore = isBlack ? s1 : s2;
    if (opponentName) {
      const result = isBlack
        ? (s1 > s2 ? 'win' : s1 < s2 ? 'lose' : 'draw')
        : (s2 > s1 ? 'win' : s2 < s1 ? 'lose' : 'draw');
      games.push({ bout, opponentName, result, color: isBlack ? 'black' : 'white' });
    } else {
      games.push({
        bout, opponentName: '',
        result: myScore >= 2 ? 'bye_win' : 'bye',
        color: isBlack ? 'black' : 'white',
      });
    }
  }
  return games;
}

/** 某轮之前（不含该轮）的累计积分，供对阵卡片显示 */
export function buildScoreMap(matches: MatchData[], upToRound?: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of matches) {
    if (upToRound != null && m.bout >= upToRound) continue;
    if (m.p1Name) map.set(m.p1Name, (map.get(m.p1Name) ?? 0) + (m.p1Score ?? 0));
    if (m.p2Name) map.set(m.p2Name, (map.get(m.p2Name) ?? 0) + (m.p2Score ?? 0));
  }
  return map;
}

/** 弹窗里对手名次的来源：只取排名表的 rank，不读插件 cells（name → rank） */
export function buildRankMap(table: RankingTable | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!table) return map;
  for (const r of table.rows) {
    map.set(r.name, r.rank);
    const cn = cleanName(r.name);
    if (cn !== r.name) map.set(cn, r.rank);
  }
  return map;
}

/** 与渲染层一致的姓名清洗规则（用于 id / 链接） */
export function cleanName(name: string): string {
  if (!name) return '';
  const m = name.match(/[\u4e00-\u9fa5]{2,4}/);
  return m ? m[0] : name.replace(/\|[\d\w:_-]+$/, '').trim();
}
