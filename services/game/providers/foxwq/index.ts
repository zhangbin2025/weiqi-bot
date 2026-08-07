/**
 * @fileoverview 野狐围棋模块导出
 */

export type { IFoxwqProvider } from './IFoxwqProvider';
export { FoxwqProvider } from './FoxwqProvider';
export { FoxwqUserProvider } from './FoxwqUserProvider';
export { FoxwqChessProvider } from './FoxwqChessProvider';
export { FoxwqPublicProvider } from './FoxwqPublicProvider';
export { FoxwqShareProvider } from './FoxwqShareProvider';

// 直播提供者（统一版）
export { FoxwqLiveProviderBase } from './FoxwqLiveProviderBase';

export { FoxwqJueyiLiveProvider } from './FoxwqJueyiLiveProvider';

// Protobuf 协议解码器
export { decodeLiveGameData, decodeLiveGameDataFromMessages } from './FoxwqProtoDecoder';
export type { LiveGameData, GameRule, GameUserInfo, SetPieceNotify, SetGameResultNotify } from './FoxwqProtoDecoder';

export type {
  FoxwqUser,
  FoxwqGame,
  PublicQipu,
  PublicQipuDetail,
} from './types';

export { formatDan, parseResult } from './parsers';
