/**
 * 网络重试策略
 * @description 对瞬时网络错误做指数退避重试，避免单次丢包直接导致请求失败
 *
 * 背景：代理链路（浏览器 → CONNECT 隧道 → 代理服务器）偶发丢包时，
 * 浏览器抛出的不是可静默重传的 TCP 错误，而是直接判死隧道
 * （Chrome 表现为 net::ERR_TUNNEL_CONNECTION_FAILED，fetch 侧为 TypeError: Failed to fetch）。
 * 这类失败是瞬时的，重试几乎必成，故在网络层统一兜底。
 *
 * 判定原则：
 * - 可重试：超时、网络不可达、连接被重置/隧道失败等传输层错误，以及 5xx、408、429。
 * - 不重试：其余 4xx（请求本身有问题，重试无意义）、认证/权限错误。
 * - 非幂等方法（POST/PATCH）默认不重试，避免重复提交；调用方显式标记后才重试。
 *
 * @ai-example
 * const res = await withRetry(() => provider.request(config), { maxAttempts: 2 });
 */

import {
  NetworkError,
  TimeoutError,
  NetworkUnreachableError,
  RequestError,
  AuthenticationError,
  PermissionError,
} from '../interfaces';

/** 默认退避基数（毫秒）：第 n 次重试等待 baseDelay * 2^(n-1) */
export const DEFAULT_RETRY_BASE_DELAY = 300;

/** 单次退避上限（毫秒），避免退避时间无限增长 */
export const DEFAULT_RETRY_MAX_DELAY = 5000;

/** 视为幂等、可安全重试的 HTTP 方法 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/** 可重试的 HTTP 状态码：服务端错误 / 请求超时 / 限流 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 507, 509]);

/** 重试时携带的诊断信息 */
export interface IRetryInfo {
  /** 第几次重试（首次重试为 1） */
  attempt: number;
  /** 允许的最大重试次数 */
  maxAttempts: number;
  /** 本次退避等待时长（毫秒） */
  delayMs: number;
  /** 触发重试的错误 */
  error: unknown;
  /** 请求 URL */
  url: string;
  /** 请求方法（已归一化为大写） */
  method: string;
  /** 判定为可重试的原因（便于排查） */
  reason: string;
}

export interface IRetryPolicyOptions {
  /** 退避基数（毫秒），默认 300 */
  baseDelay?: number;
  /** 单次退避上限（毫秒），默认 5000 */
  maxDelay?: number;
  /** 是否加入抖动，避免多个请求同时重试造成尖峰，默认 true */
  jitter?: boolean;
  /** 等待函数（测试注入用） */
  sleep?: (ms: number) => Promise<void>;
  /** 每次重试前的回调（日志/埋点用） */
  onRetry?: ((info: IRetryInfo) => void) | undefined;
}

/** 等待指定时长 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算第 attempt 次重试的退避时长（指数退避 + 可选抖动）
 * @param attempt 第几次重试（从 1 开始）
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelay: number = DEFAULT_RETRY_BASE_DELAY,
  maxDelay: number = DEFAULT_RETRY_MAX_DELAY,
  jitter: boolean = true
): number {
  const exponential = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(exponential, maxDelay);
  // 抖动取 [0.5, 1.0) 倍，保留退避趋势的同时打散重试时刻
  const factor = jitter ? 0.5 + Math.random() * 0.5 : 1;
  return Math.round(capped * factor);
}

/**
 * 判断错误是否值得重试
 * @param error 捕获到的错误
 * @param method HTTP 方法（未指定按 GET 处理）
 * @param force 是否强制允许重试（绕过幂等性检查，用于调用方显式声明安全的非幂等请求）
 */
export function isRetryableError(
  error: unknown,
  method: string = 'GET',
  force: boolean = false
): { retryable: boolean; reason: string } {
  // 非幂等方法默认不重试：重复提交可能造成副作用
  const normalized = (method || 'GET').toUpperCase();
  if (!force && !IDEMPOTENT_METHODS.has(normalized)) {
    return { retryable: false, reason: `非幂等方法 ${normalized} 不重试` };
  }

  // 认证/权限错误：重试无意义，需要重新鉴权
  if (error instanceof AuthenticationError) {
    return { retryable: false, reason: '认证失败' };
  }
  if (error instanceof PermissionError) {
    return { retryable: false, reason: '权限不足' };
  }

  // HTTP 状态错误：仅服务端错误与限流/超时可重试
  if (error instanceof RequestError) {
    const status = error.statusCode;
    if (status !== undefined && RETRYABLE_STATUS.has(status)) {
      return { retryable: true, reason: `HTTP ${status}` };
    }
    return { retryable: false, reason: status !== undefined ? `HTTP ${status}` : '请求错误' };
  }

  if (error instanceof TimeoutError) {
    return { retryable: true, reason: '请求超时' };
  }
  if (error instanceof NetworkUnreachableError) {
    return { retryable: true, reason: '网络不可达' };
  }

  // 传输层错误（含代理隧道失败、连接被重置）：fetch 侧为 TypeError，
  // Provider 统一包装为 NetworkError(code=NETWORK_ERROR / PROXY_DISABLED 等)
  if (error instanceof NetworkError) {
    // 代理被显式禁用属于配置问题，重试无意义
    if (error.code === 'PROXY_DISABLED') {
      return { retryable: false, reason: '代理已禁用' };
    }
    return { retryable: true, reason: error.code || 'NETWORK_ERROR' };
  }

  // fetch 原生失败（Provider 未包装时）：Failed to fetch / 网络断开
  if (error instanceof TypeError) {
    return { retryable: true, reason: 'TypeError（连接失败）' };
  }

  return { retryable: false, reason: '未知错误' };
}

/**
 * 带指数退避地执行异步操作
 * @param operation 每次尝试执行的操作（会被调用 1 + maxAttempts 次）
 * @param maxAttempts 最大重试次数（不含首次尝试），0 表示不重试
 * @param options 退避与回调配置
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  options: IRetryPolicyOptions = {}
): Promise<T> {
  const {
    baseDelay = DEFAULT_RETRY_BASE_DELAY,
    maxDelay = DEFAULT_RETRY_MAX_DELAY,
    jitter = true,
    sleep = defaultSleep,
    onRetry,
  } = options;

  const limit = Math.max(0, Math.floor(maxAttempts));
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const method = extractMethod(error);
      const { retryable, reason } = isRetryableError(error, method);

      if (!retryable || attempt >= limit) {
        throw error;
      }

      attempt += 1;
      const delayMs = computeBackoffDelay(attempt, baseDelay, maxDelay, jitter);

      onRetry?.({
        attempt,
        maxAttempts: limit,
        delayMs,
        error,
        url: extractUrl(error),
        method,
        reason,
      });

      await sleep(delayMs);
    }
  }
}

/** 从错误的 config 中取出 HTTP 方法（用于幂等性判定） */
function extractMethod(error: unknown): string {
  const cfg = getErrorConfig(error);
  const method = cfg?.['method'];
  return typeof method === 'string' ? method : 'GET';
}

/** 从错误的 config 中取出 URL（用于日志） */
function extractUrl(error: unknown): string {
  const cfg = getErrorConfig(error);
  const url = cfg?.['url'];
  return typeof url === 'string' ? url : '';
}

/** 读取 NetworkError.config（各 Provider 会把 IRequestConfig 挂在上面） */
function getErrorConfig(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof NetworkError && error.config) {
    return error.config as Record<string, unknown>;
  }
  return undefined;
}
