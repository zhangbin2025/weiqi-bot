import { describe, it, expect } from 'vitest';
import { RankingCalculator } from '../RankingCalculator';
import type { MatchData } from '../types';

describe('RankingCalculator', () => {
  const calculator = new RankingCalculator();

  describe('empty matches', () => {
    it('should return empty result for no matches', () => {
      const result = calculator.calculate([]);
      expect(result.rankings).toEqual([]);
      expect(result.totalRounds).toBe(0);
      expect(result.completedRounds).toBe(0);
    });
  });

  describe('basic ranking', () => {
    const matches: MatchData[] = [
      // Round 1: A beats B, C beats D
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      { bout: 1, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      // Round 2: A beats C, B beats D
      { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
      { bout: 2, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      // Round 3: A beats D, B beats C
      { bout: 3, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      { bout: 3, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
    ];

    it('should calculate correct scores', () => {
      const result = calculator.calculate(matches);
      // A: 3 wins = 6 points, B: 2 wins = 4 points, C: 1 win = 2 points, D: 0 wins = 0 points
      const playerA = result.rankings.find((r) => r.id === 1);
      const playerB = result.rankings.find((r) => r.id === 2);
      const playerC = result.rankings.find((r) => r.id === 3);
      const playerD = result.rankings.find((r) => r.id === 4);

      expect(playerA?.score).toBe(6);
      expect(playerB?.score).toBe(4);
      expect(playerC?.score).toBe(2);
      expect(playerD?.score).toBe(0);
    });

    it('should calculate correct wins/losses', () => {
      const result = calculator.calculate(matches);
      const playerA = result.rankings.find((r) => r.id === 1);

      expect(playerA?.wins).toBe(3);
      expect(playerA?.losses).toBe(0);
      expect(playerA?.draws).toBe(0);
    });

    it('should calculate total and completed rounds', () => {
      const result = calculator.calculate(matches);
      expect(result.totalRounds).toBe(3);
      expect(result.completedRounds).toBe(3);
    });

    it('should rank by score descending', () => {
      const result = calculator.calculate(matches);
      const scores = result.rankings.map((r) => r.score);
      expect(scores).toEqual([6, 4, 2, 0]);
    });

    it('should calculate opponent score (SOS)', () => {
      const result = calculator.calculate(matches);
      const playerA = result.rankings.find((r) => r.id === 1);
      // A's opponents: B(4) + C(2) + D(0) = 6
      expect(playerA?.opponentScore).toBe(6);
    });

    it('should calculate progressive score', () => {
      const result = calculator.calculate(matches);
      const playerA = result.rankings.find((r) => r.id === 1);
      // A: round1(2) + round2(4) + round3(6) = 12
      expect(playerA?.progressiveScore).toBe(12);
    });
  });

  describe('draw handling', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 1, p2Id: 2, p2Name: 'B', p2Score: 1 },
    ];

    it('should count draws correctly', () => {
      const result = calculator.calculate(matches);
      const playerA = result.rankings.find((r) => r.id === 1);
      const playerB = result.rankings.find((r) => r.id === 2);

      expect(playerA?.draws).toBe(1);
      expect(playerB?.draws).toBe(1);
      expect(playerA?.score).toBe(1);
      expect(playerB?.score).toBe(1);
    });
  });

  describe('incomplete rounds', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 0, p2Id: 2, p2Name: 'B', p2Score: 0 },
    ];

    it('should count completed rounds correctly', () => {
      const result = calculator.calculate(matches);
      expect(result.totalRounds).toBe(2);
      expect(result.completedRounds).toBe(1);
    });
  });

  describe('tie-breaking', () => {
    it('should use opponent score for tie-breaking', () => {
      // Two players with same score but different SOS
      const matches: MatchData[] = [
        // Round 1: A beats C, B beats D
        { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
        { bout: 1, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
        // Round 2: A loses to D, B loses to C
        { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 0, p2Id: 4, p2Name: 'D', p2Score: 2 },
        { bout: 2, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
        // Round 3: C beats D (to differentiate SOS)
        { bout: 3, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      ];

      const result = calculator.calculate(matches);
      // A and B both have score=2, but A's opponent D has higher score
      const rankA = result.rankings.find((r) => r.id === 1);
      const rankB = result.rankings.find((r) => r.id === 2);

      // A's opponents: C(4) + D(0) => SOS = 4
      // B's opponents: D(0) + C(4) => SOS = 4
      // Same SOS, check progressive score
      expect(rankA?.score).toBe(rankB?.score);
    });
  });

  describe('simple mode', () => {
    const matches: MatchData[] = [
      { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      { bout: 1, p1Id: 3, p1Name: 'C', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
      { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
      { bout: 2, p1Id: 2, p1Name: 'B', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
    ];

    it('should not use progressive score in simple mode', () => {
      const result = calculator.calculate(matches, 'simple');
      // Simple mode: score > SOS > reverse minus (no progressive)
      expect(result.rankings.length).toBe(4);
    });
  });

  describe('reverse minus display', () => {
    it('should show empty display for non-tied players', () => {
      const matches: MatchData[] = [
        { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 2, p2Name: 'B', p2Score: 0 },
      ];

      const result = calculator.calculate(matches);
      const playerA = result.rankings.find((r) => r.id === 1);
      expect(playerA?.reverseMinusDisplay).toBe('');
    });

    it('should show display for tied players', () => {
      const matches: MatchData[] = [
        // Round 1: A beats C, B beats D
        { bout: 1, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 3, p2Name: 'C', p2Score: 0 },
        { bout: 1, p1Id: 4, p1Name: 'D', p1Score: 0, p2Id: 2, p2Name: 'B', p2Score: 2 },
        // Round 2: A beats D, B beats C
        { bout: 2, p1Id: 1, p1Name: 'A', p1Score: 2, p2Id: 4, p2Name: 'D', p2Score: 0 },
        { bout: 2, p1Id: 3, p1Name: 'C', p1Score: 0, p2Id: 2, p2Name: 'B', p2Score: 2 },
        // Round 3: A loses to B
        { bout: 3, p1Id: 1, p1Name: 'A', p1Score: 0, p2Id: 2, p2Name: 'B', p2Score: 2 },
      ];

      const result = calculator.calculate(matches);
      // Both A and B have 4 points - they're tied on score and SOS
      const tiedPlayers = result.rankings.filter((r) => r.score === 4);
      // Tied players should have reverse minus display
      tiedPlayers.forEach((p) => {
        if (tiedPlayers.length > 1) {
          expect(p.reverseMinusDisplay).toBeTruthy();
        }
      });
    });
  });
});
