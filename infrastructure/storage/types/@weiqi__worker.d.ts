/**
 * @weiqi/worker 类型声明
 * 
 * 此文件为 kataGo-core 库提供类型声明。
 * 实际实现在 ../katago-core/src/ 中，由 Vite 在构建时解析。
 */

declare module '@weiqi/worker' {
  // Board types
  export type BoardState = any[][];
  export type Player = 'black' | 'white' | 'B' | 'W';
  export type Move = { x: number; y: number; player: Player } | { pass: true; player: Player };

  // Analysis types
  export interface AnalysisResult {
    // 实际使用的字段
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
    
    // 原始字段（保留兼容）
    moveInfos?: Array<{
      move: string;
      visits: number;
      winrate: number;
      scoreLead: number;
      scoreMean: number;
      scoreStdev: number;
      prior: number;
      pv: string[];
      ownership?: Float32Array;
    }>;
    rootInfo?: {
      winrate: number;
      scoreLead: number;
      scoreMean: number;
      scoreStdev: number;
      visits: number;
    };
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

  // KataGo Client
  export interface KataGoEngineClient {
    init(modelUrl: string, onProgress?: (loaded: number, total: number, progress: number) => void, baseUrl?: string, warmUp?: boolean): Promise<void>;
    analyze(options: {
      board: BoardState;
      currentPlayer: Player;
      moves: Move[];
      rules?: GameRules;
      komi?: number;
      visits?: number;
      [key: string]: any;
    }): Promise<AnalysisResult>;
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
    [key: string]: any;
  }

  export function getKataGoEngineClient(): KataGoEngineClient;
  export function setWorkerUrl(url: string): void;

  // Error handling
  export class KataGoCanceledError extends Error {
    constructor(message?: string);
  }

  export function isKataGoCanceledError(error: unknown): error is KataGoCanceledError;

  // Utilities
  export function getOpponent(player: Player): Player;

  // Debug
  export function setDebugEnabled(enabled: boolean): void;
}
