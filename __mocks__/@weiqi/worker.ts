/**
 * @weiqi/worker mock for tests
 */

import { vi } from 'vitest';

// Types (re-export for type checking)
export type BoardState = any[][];
export type Player = 'black' | 'white' | 'B' | 'W';
export type Move = { x: number; y: number; player: Player } | { pass: true; player: Player };

export interface AnalysisResult {
  moves: Array<{
    x: number;
    y: number;
    order: number;
    winRate: number;
    scoreLead: number;
    visits: number;
    pv: string[];
  }>;
  rootWinRate: number;
  rootScoreLead: number;
}

export interface GameState {
  board: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  captures: { black: number; white: number };
}

export interface GameRules {
  koRules: string;
  scoringRule: string;
  taxRule: string;
  hasButton: boolean;
}

export interface RegionOfInterest {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type FloatArray = Float32Array | Float64Array;

export interface CandidateMove {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  prior: number;
  pv: string[];
}

export interface KataGoEngineClient {
  init(modelUrl: string, onProgress?: (loaded: number, total: number, progress: number) => void, baseUrl?: string, warmUp?: boolean): Promise<void>;
  analyze(options: any): Promise<AnalysisResult>;
  evaluate(options: any): Promise<any>;
  evaluateBatch(options: any): Promise<any>;
  getEngineInfo(): EngineInfo;
  cancel(): void;
}

export interface EngineInfo {
  version: string;
  modelInfo: string;
  backend: string;
  modelName: string;
}

// Mock implementations
const mockEngineClient: KataGoEngineClient = {
  init: vi.fn().mockResolvedValue(undefined),
  analyze: vi.fn().mockResolvedValue({
    rootWinRate: 0.55,
    rootScoreLead: 3.5,
    moves: [],
  }),
  evaluate: vi.fn().mockResolvedValue({}),
  evaluateBatch: vi.fn().mockResolvedValue([]),
  getEngineInfo: vi.fn().mockReturnValue({ backend: 'test', modelName: 'test-model', version: '1.0', modelInfo: 'test' }),
  cancel: vi.fn(),
};

export const getKataGoEngineClient = vi.fn(() => mockEngineClient);
export const setWorkerUrl = vi.fn();

export class KataGoCanceledError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'KataGoCanceledError';
  }
}

export const isKataGoCanceledError = vi.fn((error: unknown) => 
  error instanceof Error && error.name === 'KataGoCanceledError'
);

export const getOpponent = vi.fn((player: string) => 
  player === 'black' ? 'white' : 'black'
);

export const setDebugEnabled = vi.fn();