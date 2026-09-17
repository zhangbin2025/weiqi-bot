import { describe, it, expect } from 'vitest';
import { OgsPuzzleProvider } from '../OgsPuzzleProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';

describe('OgsPuzzleProvider - puzzle 2640 deep correct_answer', () => {
  it('should classify branch with deep correct_answer as 正解图', async () => {
    const mockResponse = {
      id: 2640,
      name: 'Exercise 008 - solution',
      created: '2020-01-01T00:00:00Z',
      modified: '2020-01-01T00:00:00Z',
      puzzle: {
        name: 'Exercise 008 - solution',
        puzzle_rank: '10',
        move_tree: {
          x: -1, y: -1,
          branches: [
            {
              x: 3, y: 18,
              branches: [
                {
                  x: 4, y: 18,
                  branches: [
                    { x: 4, y: 17, correct_answer: true }
                  ]
                },
                {
                  x: 4, y: 17,
                  branches: [
                    {
                      x: 4, y: 18,
                      branches: [
                        {
                          x: 5, y: 18,
                          branches: [
                            {
                              x: 5, y: 17,
                              branches: [
                                { x: 2, y: 18, branches: [{ x: 4, y: 18, correct_answer: true }] }
                              ]
                            }
                          ]
                        },
                        { x: 5, y: 17, branches: [{ x: 5, y: 18, correct_answer: true }] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        initial_player: 'black',
        height: 19,
        width: 19,
        mode: 'puzzle',
        puzzle_type: 'life_and_death',
        initial_state: { white: 'dr cr br ar bs', black: 'bq aq cq dq eq fq gr hr' },
      },
      private: false,
      width: 19,
      height: 19,
      type: 'life_and_death',
      has_solution: true,
      rank: 10,
    };

    const mockNetwork = { request: vi.fn().mockResolvedValueOnce({ data: JSON.stringify(mockResponse) }) };
    const provider = new OgsPuzzleProvider(mockNetwork as any);
    const result = await provider.fetch('https://online-go.com/puzzle/2640');

    expect(result.success).toBe(true);
    // The top-level branch should be classified as 正解图 because
    // deep in its subtree there are correct_answer nodes
    expect(result.sgfContent).toContain('正解图');
    // Should NOT be 变化图
    expect(result.sgfContent).not.toContain('变化图');
  });
});
