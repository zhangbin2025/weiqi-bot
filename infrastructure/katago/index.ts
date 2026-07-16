/**
 * @fileoverview KataGo 原生桥接模块入口
 */

export { KataGoNativeClient, getKataGoNativeClient, isNativeKatagoAvailable } from './KataGoNativeClient';
export type { KataGoStartOptions, KataGoStatus, KataGoSendResult } from './KataGoNativeClient';
export { KataGoQueryBuilder } from './KataGoQueryBuilder';
export { KataGoResultParser } from './KataGoResultParser';
