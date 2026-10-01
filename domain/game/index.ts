export type { GamePhase, IGameState, IMoveResult } from './IGameState';
export type { IGameConfig, IGame } from './IGame';
export { Game } from './Game';
export {
  formatGameResult,
  parseResultFromWinnerReason,
  parseResultFromCode,
  parseResultFromText,
  type ResultReason,
} from './GameResult';
export { normalizeKomi, komiFromProto, komiForHandicap } from './KomiNormalizer';
