/**
 * @fileoverview Game 服务辅助函数
 */

import type { PlatformCapabilities } from '../../infrastructure/platform/interfaces';
import { PlatformDetector } from '../../infrastructure/platform';
import type { FetchResult } from './providers/base/types';

/** Playwright 平台列表 */
const PLAYWRIGHT_PLATFORMS = [
  'txwq.qq.com',
  'h5.txwq.qq.com',
  'yikeweiqi.com/game',
  '1919weiqi.com',
  'izis.cn',
  'xinboduiyi.com',
  'shaoer.yikeweiqi.com'
];

/** 创建不支持的结果 */
export function createUnsupportedResult(url: string): FetchResult {
  const platform = PlatformDetector.detect();
  const capabilities = PlatformDetector.getCapabilities(platform);

  return {
    success: false,
    source: 'unknown',
    url,
    sgfContent: null,
    metadata: {
      source: 'unknown',
      gameId: '',
      blackName: '',
      whiteName: '',
      width: 19,
      height: 19,
      komi: 6.5,
      handicap: 0,
      rules: '',
      date: '',
      movesCount: 0,
    },
    error: getUnsupportedMessage(platform, capabilities, url),
  };
}

/** 创建错误结果 */
export function createErrorResult(url: string, error: unknown): FetchResult {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return {
    success: false,
    source: 'error',
    url,
    sgfContent: null,
    metadata: {
      source: 'error',
      gameId: '',
      blackName: '',
      whiteName: '',
      width: 19,
      height: 19,
      komi: 6.5,
      handicap: 0,
      rules: '',
      date: '',
      movesCount: 0,
    },
    error: errorMessage,
  };
}

/** 获取不支持提示消息 */
export function getUnsupportedMessage(
  platform: string,
  capabilities: PlatformCapabilities,
  url: string
): string {
  return '当前环境不支持此请求。';
}