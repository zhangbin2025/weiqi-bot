/**
 * SGF 解析模块导出
 * @module domain/sgf
 */

// 新版类型（对齐 Python）
export type {
  SGFPropValue,
  SGFProperties,
  ISGFNode,
  HandicapStone,
  ISGFGameInfoFull,
  ISGFStats,
  VariationMove,
  ISGFVariation,
  WinratePoint,
  ISGFParseResult,
  ISGFParser,
} from './types';

// 旧版类型（向后兼容）
export type {
  ISGFProperty,
  ISGFNodeLegacy,
  ISGFGameInfo,
  ISGFParseResultLegacy,
} from './types';

// 解析器
export { SGFParser, parseSGF, coordToPos, posToCoord } from './SGFParser';

// 写入器
export type { ISGFWriter, ISGFWriteOptions } from './ISGFWriter';
export { SGFWriter } from './SGFWriter';

// ReplayData 转换器
export { sgfToReplayData, type ReplayData, type ReplayNode, type SGFToReplayOptions } from './SGFToReplay';
