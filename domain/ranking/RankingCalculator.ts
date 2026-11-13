/**
 * 内置排名实现
 * @module domain/ranking/RankingCalculator
 *
 * 与插件共用同一契约：输入只有原始对阵，产出 RankingOutput（columns + cells）。
 * cells 值为数值或数值数组；name/rank/id 是宿主保留的结构列，不在 cells 里。
 * 积分、对手分、累进分、逆减、胜局数等一切中间量都在这里从对阵算出，
 * 宿主不预先提供任何计算好的字段。
 *
 * rank(input, mode?) 是唯一实现入口。mode 只是内置实现的预设口径；
 * 插件实现同一个 rank(input) 契约，忽略第二参数，自己决定口径与列。
 */

import type {
  MatchData, RankingInput, RankingOutput, RankingMode, InternalPlayer, RankingCellValue,
} from './types';

export class RankingCalculator {
  /** 唯一实现入口：对阵表 → 排名表。与插件的 rank(input) 是同一个契约。 */
  rank(input: RankingInput, mode: RankingMode = 'default'): RankingOutput {
    const matches = input.matches;
    if (matches.length === 0) return { columns: this.columns(mode), rows: [] };

    const players = this.initializePlayers(matches);
    for (const match of matches) this.processMatch(players, match);
    this.calculateSecondaryScores(players);

    const sorted = this.sortPlayers(players, mode);
    this.computeReverseMinusValue(sorted, mode);

    const columns = this.columns(mode);
    const rows = sorted.map((p, index) => {
      const cells: Record<string, RankingCellValue> = {
        score: Math.floor(p.score),
        opponentScore: Math.floor(p.opponentScore),
      };
      if (mode === 'directWin') {
        const tied = sorted.filter((o) => o.id !== p.id && o.score === p.score && o.opponentScore === p.opponentScore);
        const result = tied.length === 1 ? p.directWinResults.get(tied[0]!.id) : undefined;
        // 1=胜, 0=无直胜/和, -1=负；纯数值，列名固定汉字「直胜」
        cells['directWin'] = result === 1 ? 1 : result === -1 ? -1 : 0;
      }
      if (mode !== 'simple') {
        cells['progressiveScore'] = Math.floor(p.progressiveScore);
      }
      // 逆减显示值：[轮次序号, 该轮逆减值]，数值化后渲染仍为 3-12（延续老版展示格式）
      cells['reverseMinus'] = p.reverseMinusValue;
      return { id: p.id, name: p.name, rank: index + 1, cells };
    });
    return { columns, rows };
  }

  /** 内置列定义。列名纯汉字，key 与 cells 一一对应。插件可自由定义自己的列。 */
  private columns(mode: RankingMode): RankingOutput['columns'] {
    const cols: RankingOutput['columns'] = [
      { key: 'score', label: '积分' },
      { key: 'opponentScore', label: '对手分' },
    ];
    if (mode === 'directWin') cols.push({ key: 'directWin', label: '直胜' });
    if (mode !== 'simple') cols.push({ key: 'progressiveScore', label: '累进分' });
    cols.push({ key: 'reverseMinus', label: '逆减' });
    return cols;
  }

  private initializePlayers(matches: MatchData[]): Map<number, InternalPlayer> {
    const players = new Map<number, InternalPlayer>();
    for (const match of matches) {
      if (match.p1Id && match.p1Name && !players.has(match.p1Id)) {
        players.set(match.p1Id, this.createPlayer(match.p1Id, match.p1Name));
      }
      if (match.p2Id && match.p2Name && !players.has(match.p2Id)) {
        players.set(match.p2Id, this.createPlayer(match.p2Id, match.p2Name));
      }
    }
    return players;
  }

  private createPlayer(id: number, name: string): InternalPlayer {
    return {
      id, name, score: 0, opponentScore: 0, progressiveScore: 0,
      wins: 0, losses: 0, draws: 0,
      opponents: [], progressive: [], roundOpponents: [],
      reverseMinus: [], reverseMinusValue: [],
      directWinResults: new Map(),
    };
  }

  private processMatch(players: Map<number, InternalPlayer>, match: MatchData): void {
    const { bout, p1Id, p1Name, p1Score, p2Id, p2Name, p2Score } = match;
    const gameCompleted = p1Score !== 0 || p2Score !== 0;
    if (p1Id && players.has(p1Id)) {
      this.updatePlayerStats(players.get(p1Id)!, p1Score, p2Id, p2Name, bout, gameCompleted);
    }
    if (p2Id && players.has(p2Id)) {
      this.updatePlayerStats(players.get(p2Id)!, p2Score, p1Id, p1Name, bout, gameCompleted);
    }
  }

  private updatePlayerStats(
    player: InternalPlayer, score: number, opponentId: number,
    opponentName: string, bout: number, gameCompleted: boolean,
  ): void {
    if (opponentId && opponentName) {
      player.opponents.push(opponentId);
      player.roundOpponents.push({ bout, opponentId, opponentName });
      if (gameCompleted) {
        const result = score === 2 ? 1 : score === 0 ? -1 : 0.5;
        player.directWinResults.set(opponentId, result);
      }
    }
    if (gameCompleted) {
      if (score === 2) player.wins++;
      else if (score === 0) player.losses++;
      else player.draws++;
    }
    player.score += score;
    player.progressive.push(player.score);
  }

  private calculateSecondaryScores(players: Map<number, InternalPlayer>): void {
    for (const player of players.values()) {
      player.opponentScore = player.opponents.reduce(
        (sum, oid) => sum + (players.get(oid)?.score ?? 0), 0,
      );
      player.progressiveScore = player.progressive.reduce((sum, s) => sum + s, 0);
      this.calculateReverseMinus(player, players);
    }
  }

  private calculateReverseMinus(player: InternalPlayer, allPlayers: Map<number, InternalPlayer>): void {
    const roundOpponents = [...player.roundOpponents].sort((a, b) => a.bout - b.bout);
    const roundScores = roundOpponents.map((r) => allPlayers.get(r.opponentId)?.score ?? 0);
    const opponentScore = roundScores.reduce((sum, s) => sum + s, 0);
    player.reverseMinus = [];
    if (opponentScore > 0) {
      let cumulative = 0;
      for (const s of roundScores) {
        cumulative += s;
        player.reverseMinus.push(opponentScore - cumulative);
      }
    }
  }

  private sortPlayers(players: Map<number, InternalPlayer>, mode: RankingMode): InternalPlayer[] {
    const sorted = Array.from(players.values());
    sorted.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.opponentScore !== a.opponentScore) return b.opponentScore - a.opponentScore;
      if (mode === 'directWin') {
        const dw = this.compareDirectWin(a, b);
        if (dw !== 0) return dw;
        return this.compareReverseMinus(a, b);
      }
      if (mode !== 'simple' && b.progressiveScore !== a.progressiveScore) {
        return b.progressiveScore - a.progressiveScore;
      }
      return this.compareReverseMinus(a, b);
    });
    return sorted;
  }

  private compareDirectWin(a: InternalPlayer, b: InternalPlayer): number {
    const aVsB = a.directWinResults.get(b.id);
    if (aVsB === 1) return -1;
    if (aVsB === -1) return 1;
    return 0;
  }

  private compareReverseMinus(a: InternalPlayer, b: InternalPlayer): number {
    for (let i = 0; i < Math.max(a.reverseMinus.length, b.reverseMinus.length); i++) {
      const aVal = a.reverseMinus[i] ?? 0;
      const bVal = b.reverseMinus[i] ?? 0;
      if (bVal !== aVal) return bVal - aVal;
    }
    return 0;
  }

  /**
   * 破同分时展示用的逆减值，与重构前老版 processTieBreakDisplay 逐字等价：
   * 同分组内找「首个能把所有人区分开的轮次」，显示 [轮次序号, 该轮逆减值]；
   * 找不到区分轮次则显示 [逆减轮数, 最后一个逆减值]；无逆减数据或非同分为 []。
   * 老版是 "3-12" 这类字符串，统一契约要求数值化，故用 [3, 12]（渲染仍为 3-12）。
   */
  private computeReverseMinusValue(players: InternalPlayer[], mode: RankingMode): void {
    let i = 0;
    while (i < players.length) {
      let j = i + 1;
      while (j < players.length && this.isTied(players[i]!, players[j]!, mode)) j++;
      const group = players.slice(i, j);
      if (group.length <= 1) {
        if (group[0]) group[0].reverseMinusValue = [];
        i = j;
        continue;
      }
      const maxRounds = Math.max(...group.map((p) => p.reverseMinus.length));
      let chosen = -1;
      for (let round = 0; round < maxRounds; round++) {
        const values = group.map((p) => p.reverseMinus[round] ?? 0);
        if (new Set(values).size === group.length) { chosen = round; break; }
      }
      if (chosen >= 0) {
        // 轮次号从 1 起，与老版 `${round + 1}-${value}` 一致
        for (const p of group) {
          p.reverseMinusValue = [chosen + 1, Math.floor(p.reverseMinus[chosen] ?? 0)];
        }
      } else {
        // 老版兜底 `${length}-${last}`；无逆减数据时老版显示 '-'，
        // 数值契约不支持字符串，用空数组（渲染为空）表达同一「无数据」语义。
        for (const p of group) {
          p.reverseMinusValue = p.reverseMinus.length > 0
            ? [p.reverseMinus.length, Math.floor(p.reverseMinus[p.reverseMinus.length - 1] ?? 0)]
            : [];
        }
      }
      i = j;
    }
  }

  private isTied(a: InternalPlayer, b: InternalPlayer, mode: RankingMode): boolean {
    if (a.score !== b.score || a.opponentScore !== b.opponentScore) return false;
    if (mode === 'default') return a.progressiveScore === b.progressiveScore;
    if (mode === 'directWin') {
      const aVsB = a.directWinResults.get(b.id);
      if (aVsB !== undefined && aVsB !== 0.5) return false;
      return true;
    }
    return true;
  }
}
