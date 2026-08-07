import type { IRankingCalculator } from './IRankingCalculator';
import type { MatchData, PlayerRanking, RankingResult, RankingMode, InternalPlayer } from './types';

/** 排名计算器实现 */
export class RankingCalculator implements IRankingCalculator {
  calculate(matches: MatchData[], mode: RankingMode = 'default'): RankingResult {
    if (matches.length === 0) {
      return { rankings: [], totalRounds: 0, completedRounds: 0 };
    }

    const totalRounds = Math.max(...matches.map((m) => m.bout));
    const completedRounds = this.countCompletedRounds(matches, totalRounds);
    const players = this.initializePlayers(matches);

    for (const match of matches) this.processMatch(players, match);
    this.calculateSecondaryScores(players);

    const sortedPlayers = this.sortPlayers(players, mode);
    this.processTieBreakDisplay(sortedPlayers, mode);

    return { rankings: this.generateRankings(sortedPlayers, matches), totalRounds, completedRounds };
  }

  private countCompletedRounds(matches: MatchData[], totalRounds: number): number {
    let completed = 0;
    for (let bout = 1; bout <= totalRounds; bout++) {
      const roundMatches = matches.filter((m) => m.bout === bout);
      if (roundMatches.some((m) => m.p1Score !== 0 || m.p2Score !== 0)) completed++;
    }
    return completed;
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
      reverseMinus: [], reverseMinusDisplay: '',
      directWinResults: new Map(), // opponentId → 1(win)/0(lose)/0.5(draw)
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
    opponentName: string, bout: number, gameCompleted: boolean
  ): void {
    if (opponentId && opponentName) {
      player.opponents.push(opponentId);
      player.roundOpponents.push({ bout, opponentId, opponentName });
      // 记录直胜结果
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
        (sum, oid) => sum + (players.get(oid)?.score ?? 0), 0
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
      for (let i = roundScores.length - 1; i >= 0; i--) {
        cumulative += roundScores[i] ?? 0;
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
        // 直胜：仅2人同分同对手分时，看直接胜负关系
        const dw = this.compareDirectWin(a, b);
        if (dw !== 0) return dw;
      } else if (mode !== 'simple') {
        // default 模式：用累进分
        if (b.progressiveScore !== a.progressiveScore) {
          return b.progressiveScore - a.progressiveScore;
        }
      }

      return this.compareReverseMinus(a, b);
    });
    return sorted;
  }

  /** 直胜比较：a 赢过 b 则 a 排前（仅限2人同分时有效） */
  private compareDirectWin(a: InternalPlayer, b: InternalPlayer): number {
    const aVsB = a.directWinResults.get(b.id);
    if (aVsB === 1) return -1;  // a 赢了 b，a 排前
    if (aVsB === -1) return 1;  // a 输给 b，b 排前
    return 0; // 未对局或和棋，无法区分
  }

  private compareReverseMinus(a: InternalPlayer, b: InternalPlayer): number {
    for (let i = 0; i < Math.max(a.reverseMinus.length, b.reverseMinus.length); i++) {
      const aVal = a.reverseMinus[i] ?? 0;
      const bVal = b.reverseMinus[i] ?? 0;
      if (bVal !== aVal) return bVal - aVal;
    }
    return 0;
  }

  /** 判断两名选手是否在当前模式下排名相同 */
  private isTied(a: InternalPlayer, b: InternalPlayer, mode: RankingMode): boolean {
    if (a.score !== b.score || a.opponentScore !== b.opponentScore) return false;
    if (mode === 'default') return a.progressiveScore === b.progressiveScore;
    if (mode === 'directWin') {
      // 如果两人对局过且有胜负，不算同分
      const aVsB = a.directWinResults.get(b.id);
      if (aVsB !== undefined && aVsB !== 0.5) return false;
      return true;
    }
    // simple
    return true;
  }

  private processTieBreakDisplay(players: InternalPlayer[], mode: RankingMode): void {
    let i = 0;

    while (i < players.length) {
      let j = i + 1;
      while (j < players.length) {
        const pi = players[i]!;
        const pj = players[j]!;
        const sameBasic = this.isTied(pi, pj, mode);
        if (sameBasic) j++;
        else break;
      }

      const group = players.slice(i, j);
      if (group.length > 1) {
        const maxRounds = Math.max(...group.map((p) => p.reverseMinus.length));
        for (let round = 0; round < maxRounds; round++) {
          const values = group.map((p) => p.reverseMinus[round] ?? 0);
          if (new Set(values).size === group.length) {
            group.forEach((p) => {
              p.reverseMinusDisplay = `${round + 1}-${Math.floor(p.reverseMinus[round] ?? 0)}`;
            });
            break;
          }
        }
        group.forEach((p) => {
          if (!p.reverseMinusDisplay) {
            p.reverseMinusDisplay = p.reverseMinus.length > 0
              ? `${p.reverseMinus.length}-${Math.floor(p.reverseMinus[p.reverseMinus.length - 1] ?? 0)}`
              : '-';
          }
        });
      } else {
        group[0]!.reverseMinusDisplay = '';
      }
      i = j;
    }
  }

  private generateRankings(players: InternalPlayer[], matches: MatchData[]): PlayerRanking[] {
    const totalRounds = matches.length > 0 ? Math.max(...matches.map((m) => m.bout)) : 0;
    return players.map((p, index) => {
      // 构建每轮对局记录（含轮空）
      const games: PlayerRanking['games'] = [];
      for (let bout = 1; bout <= totalRounds; bout++) {
        const match = matches.find((m) => m.bout === bout && (m.p1Id === p.id || m.p2Id === p.id));
        if (match) {
          const isBlack = match.p1Id === p.id;
          const opponentId = isBlack ? match.p2Id : match.p1Id;
          const opponentName = isBlack ? match.p2Name : match.p1Name;
          const s1 = match.p1Score ?? 0, s2 = match.p2Score ?? 0;
          const myScore = isBlack ? s1 : s2;
          if (opponentId && opponentName) {
            // 正常对局
            const result = isBlack
              ? (s1 > s2 ? 'win' : s1 < s2 ? 'lose' : 'draw')
              : (s2 > s1 ? 'win' : s2 < s1 ? 'lose' : 'draw');
            games.push({ bout, opponentName, result, color: isBlack ? 'black' as const : 'white' as const });
          } else {
            // 对方轮空（自己有对局记录，对手为空）
            games.push({
              bout, opponentName: '',
              result: myScore >= 2 ? 'bye_win' : 'bye',
              color: isBlack ? 'black' as const : 'white' as const,
            });
          }
        } else {
          // 自己轮空（该轮没有自己的对局记录）
          games.push({ bout, opponentName: '', result: 'bye', color: 'black' as const });
        }
      }
      // 计算直胜信息：仅2人同分同对手分时显示✓/×，其它显示-
      let directWin = '-';
      // 找同分同对手分的人
      const tiedPlayers = players.filter(op => op.id !== p.id && op.score === p.score && op.opponentScore === p.opponentScore);
      if (tiedPlayers.length === 1) {
        // 恰好2人同分，看直胜结果
        const opp = tiedPlayers[0]!;
        const result = p.directWinResults.get(opp.id);
        if (result === 1) directWin = '✓';
        else if (result === -1) directWin = '×';
      }

      return {
        id: p.id, name: p.name, rank: index + 1,
        score: Math.floor(p.score),
        opponentScore: Math.floor(p.opponentScore),
        progressiveScore: Math.floor(p.progressiveScore),
        reverseMinus: p.reverseMinus.map((v) => Math.floor(v)),
        reverseMinusDisplay: p.reverseMinusDisplay,
        directWin,
        wins: p.wins, losses: p.losses, draws: p.draws,
        games,
      };
    });
  }
}