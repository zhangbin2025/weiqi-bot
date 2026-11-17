/**
 * 内置排名实现（标准口径）
 * @module domain/ranking/RankingCalculator
 *
 * 与插件共用同一契约：输入只有原始对阵，产出 RankingOutput（columns + cells）。
 * rank(input) 是唯一入口；内置只实现「标准」这一种口径，其余口径由排名插件自行实现。
 * 积分、对手分、累进分、逆减等一切中间量都在这里从对阵算出，宿主不预置字段。
 */

import type {
  MatchData, RankingInput, RankingOutput, InternalPlayer, RankingCellValue,
} from './types';

export class RankingCalculator {
  /** 唯一实现入口：对阵表 → 排名表。与插件的 rank(input) 是同一个契约。 */
  rank(input: RankingInput): RankingOutput {
    const matches = input.matches;
    if (matches.length === 0) return { columns: this.columns(), rows: [] };

    const players = this.initializePlayers(matches);
    for (const match of matches) this.processMatch(players, match);
    this.calculateSecondaryScores(players);

    const sorted = this.sortPlayers(players);
    this.computeReverseMinusValue(sorted);

    const columns = this.columns();
    const rows = sorted.map((p, index) => {
      const cells: Record<string, RankingCellValue> = {
        score: Math.floor(p.score),
        opponentScore: Math.floor(p.opponentScore),
        progressiveScore: Math.floor(p.progressiveScore),
        reverseMinus: p.reverseMinusValue,
      };
      return { id: p.id, name: p.name, rank: index + 1, cells };
    });
    return { columns, rows };
  }

  /** 标准口径的列定义。列名纯汉字，key 与 cells 一一对应。插件可自由定义自己的列。 */
  private columns(): RankingOutput['columns'] {
    return [
      { key: 'score', label: '积分' },
      { key: 'opponentScore', label: '对手分' },
      { key: 'progressiveScore', label: '累进分' },
      { key: 'reverseMinus', label: '逆减' },
    ];
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
      opponents: [], progressive: [], roundOpponents: [],
      reverseMinus: [], reverseMinusValue: [],
    };
  }

  private processMatch(players: Map<number, InternalPlayer>, match: MatchData): void {
    const { bout, p1Id, p1Name, p1Score, p2Id, p2Name, p2Score } = match;
    if (p1Id && players.has(p1Id)) {
      this.updatePlayerStats(players.get(p1Id)!, p1Score, p2Id, p2Name, bout);
    }
    if (p2Id && players.has(p2Id)) {
      this.updatePlayerStats(players.get(p2Id)!, p2Score, p1Id, p1Name, bout);
    }
  }

  private updatePlayerStats(
    player: InternalPlayer, score: number, opponentId: number,
    opponentName: string, bout: number,
  ): void {
    if (opponentId && opponentName) {
      player.opponents.push(opponentId);
      player.roundOpponents.push({ bout, opponentId, opponentName });
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

  /** 标准口径：积分 → 对手分 → 累进分 → 逆减 */
  private sortPlayers(players: Map<number, InternalPlayer>): InternalPlayer[] {
    const sorted = Array.from(players.values());
    sorted.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.opponentScore !== a.opponentScore) return b.opponentScore - a.opponentScore;
      if (b.progressiveScore !== a.progressiveScore) return b.progressiveScore - a.progressiveScore;
      return this.compareReverseMinus(a, b);
    });
    return sorted;
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
   * 破同分时展示用的逆减值：同分组内找「首个能把所有人区分开的轮次」，
   * 显示 [轮次序号, 该轮逆减值]；找不到区分轮次则显示 [逆减轮数, 最后一个逆减值]；
   * 无逆减数据或非同分为 []。数值化后渲染仍为 3-12。
   */
  private computeReverseMinusValue(players: InternalPlayer[]): void {
    let i = 0;
    while (i < players.length) {
      let j = i + 1;
      while (j < players.length && this.isTied(players[i]!, players[j]!)) j++;
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
        for (const p of group) {
          p.reverseMinusValue = [chosen + 1, Math.floor(p.reverseMinus[chosen] ?? 0)];
        }
      } else {
        for (const p of group) {
          p.reverseMinusValue = p.reverseMinus.length > 0
            ? [p.reverseMinus.length, Math.floor(p.reverseMinus[p.reverseMinus.length - 1] ?? 0)]
            : [];
        }
      }
      i = j;
    }
  }

  /** 标准口径下：积分、对手分、累进分全相同才算同分组 */
  private isTied(a: InternalPlayer, b: InternalPlayer): boolean {
    return a.score === b.score
      && a.opponentScore === b.opponentScore
      && a.progressiveScore === b.progressiveScore;
  }
}
