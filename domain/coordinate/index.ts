export type { ICoordinate } from './ICoordinate';
export type { ICoordinateConverter } from './ICoordinateConverter';
export type { CornerKey, ICornerRange, ICornerConfig } from './ICorner';
export {
  createCoordinate,
  getCoordinateKey,
  isSameCoordinate,
  getManhattanDistance,
  getAdjacentCoordinates,
} from './ICoordinate';
export { CoordinateConverter } from './CoordinateConverter';
export { getCornerRanges, getCornerConfigs } from './ICorner';
export { convertToTopRight, normalizeCornerSequence, compareCoordSequences } from './CornerConverter';