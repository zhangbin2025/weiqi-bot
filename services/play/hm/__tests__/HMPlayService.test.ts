/**
 * @fileoverview 人机对弈服务测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HMPlayService } from '../HMPlayService';
import { AIController } from '../../../ai/AIController';
import type { IGame, IGameState, IMoveResult, IBoard, MoveOrPass } from '../../../../domain';
import type { IAIEngine, AnalyzeOptions } from '../../../../infrastructure/ai';
import type { BoardState, PlayerColor } from '../../../../domain';
import { createEmptyBoardState, createMove } from '../../../../domain';

// Mock Board
const createMockBoard = (state?: BoardState): IBoard => {
  const boardState: BoardState = state ?? createEmptyBoardState(19);
  return {
    size: 19,
    getStone: (x: number, y: number) => boardState[y]?.[x] ?? null,
    setStone: vi.fn(),
    isValidPosition: vi.fn(() => true),
    clone: vi.fn(),
  } as unknown as IBoard;
};

// Mock Game
const createMockGame = (): IGame => {
  let state: IGameState = {
    board: createMockBoard(),
    currentPlayer: 'black' as PlayerColor,
    moveHistory: [] as MoveOrPass[],
    phase: 'playing',
    capturedBlack: 0,
    capturedWhite: 0,
    koPosition: null,
    handicap: 0,
    komi: 7.5,
  };

  return {
    getState: () => state,
    placeStone: vi.fn((x: number, y: number): IMoveResult => {
      state = {
        ...state,
        currentPlayer: state.currentPlayer === 'black' ? 'white' : 'black',
        moveHistory: [...state.moveHistory, createMove(x, y, state.currentPlayer, state.moveHistory.length + 1)],
      };
      return { success: true, captured: [] };
    }),
    pass: vi.fn(() => {
      state = {
        ...state,
        currentPlayer: state.currentPlayer === 'black' ? 'white' : 'black',
      };
    }),
    undo: vi.fn((): boolean => {
      if (state.moveHistory.length === 0) return false;
      state = {
        ...state,
        moveHistory: state.moveHistory.slice(0, -1),
        currentPlayer: state.currentPlayer === 'black' ? 'white' : 'black',
      };
      return true;
    }),
    newGame: vi.fn(() => {
      state = {
        board: createMockBoard(),
        currentPlayer: 'black' as PlayerColor,
        moveHistory: [] as MoveOrPass[],
        phase: 'playing',
        capturedBlack: 0,
        capturedWhite: 0,
        koPosition: null,
        handicap: 0,
        komi: 7.5,
      };
    }),
    getBoard: () => state.board,
    getHandicapStones: vi.fn(() => []), // 添加让子棋子方法
    setHandicapStones: vi.fn(),
    canPlaceStone: vi.fn(() => true),
  } as unknown as IGame;
};

// Mock AI Engine
const createMockEngine = (): IAIEngine => {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    analyze: vi.fn(async (options: AnalyzeOptions) => ({
      rootWinRate: 0.52,
      rootScoreLead: 1.5,
      moves: [
        { x: 3, y: 3, winRate: 0.53, scoreLead: 1.6, visits: options.visits ?? 100, order: 1 },
      ],
    })),
    evaluate: vi.fn().mockResolvedValue({}),
    evaluateBatch: vi.fn().mockResolvedValue([]),
    getEngineInfo: vi.fn().mockReturnValue({ backend: 'wasm', modelName: 'katago-small' }),
  } as unknown as IAIEngine;
};

describe('HMPlayService', () => {
  let service: HMPlayService;
  let mockGame: IGame;
  let mockAiController: AIController;
  let mockEngine: IAIEngine;

  beforeEach(() => {
    mockGame = createMockGame();
    mockEngine = createMockEngine();
    mockAiController = new AIController(mockEngine, 'medium');
    service = new HMPlayService(mockGame, mockAiController);
  });

  describe('newGame', () => {
    it('should start new game with config', async () => {
      await service.newGame({
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'katago-small',
      });

      expect(mockGame.newGame).toHaveBeenCalled();
      expect(service.isEnded()).toBe(false);
    });

    it('should trigger AI move when player is white', async () => {
      await service.newGame({
        playerColor: 'white',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'katago-small',
      });

      expect(mockEngine.analyze).toHaveBeenCalled();
    });
  });

  describe('playerMove', () => {
    beforeEach(async () => {
      await service.newGame({
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'katago-small',
      });
    });

    it('should place stone on player turn', async () => {
      const result = await service.playerMove(3, 3);
      expect(result).toBe(true);
      expect(mockGame.placeStone).toHaveBeenCalledWith(3, 3);
    });

    it('should return to player turn after AI moves', async () => {
      await service.playerMove(3, 3);
      expect(service.isPlayerTurn()).toBe(true);
    });
  });

  describe('isPlayerTurn', () => {
    it('should return true on player turn', async () => {
      await service.newGame({
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'katago-small',
      });

      expect(service.isPlayerTurn()).toBe(true);
    });
  });

  describe('canUndo', () => {
    it('should return false in noUndo mode', async () => {
      await service.newGame({
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: true,
        modelId: 'katago-small',
      });

      expect(service.canUndo()).toBe(false);
    });
  });

  describe('callbacks', () => {
    it('should call onBoardChange callback', async () => {
      const onBoardChange = vi.fn();
      service.setCallbacks({ onBoardChange });

      await service.newGame({
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'katago-small',
      });

      expect(onBoardChange).toHaveBeenCalled();
    });

    it('should call onPlayerChange callback', async () => {
      const onPlayerChange = vi.fn();
      service.setCallbacks({ onPlayerChange });

      await service.newGame({
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'katago-small',
      });

      expect(onPlayerChange).toHaveBeenCalledWith('black');
    });
  });
});