/**
 * 网络错误类型
 * @description 定义网络层可能抛出的所有错误类型
 * @ai-example
 * try {
 *   await provider.request({ url: '/api/games' });
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.log('Request timeout');
 *   }
 * }
 */

/**
 * 网络错误基类
 */
export class NetworkError extends Error {
  /** 错误代码 */
  readonly code: string;

  /** 提供者名称 */
  readonly provider?: string | undefined;

  /** 请求配置 */
  readonly config?: unknown;

  constructor(
    message: string,
    code: string,
    provider?: string,
    config?: unknown
  ) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.provider = provider;
    this.config = config;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends NetworkError {
  /** 超时时间（毫秒） */
  readonly timeout: number;

  constructor(timeout: number, provider?: string, config?: unknown) {
    super(`Request timeout after ${timeout}ms`, 'TIMEOUT', provider, config);
    this.name = 'TimeoutError';
    this.timeout = timeout;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * 网络不可达错误
 */
export class NetworkUnreachableError extends NetworkError {
  /** 请求 URL */
  readonly url: string;

  constructor(url: string, provider?: string, config?: unknown) {
    super(`Network unreachable: ${url}`, 'NETWORK_UNREACHABLE', provider, config);
    this.name = 'NetworkUnreachableError';
    this.url = url;
    Object.setPrototypeOf(this, NetworkUnreachableError.prototype);
  }
}

/**
 * 认证错误
 */
export class AuthenticationError extends NetworkError {
  constructor(message: string = 'Authentication failed', provider?: string, config?: unknown) {
    super(message, 'AUTH_FAILED', provider, config);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * 权限错误
 */
export class PermissionError extends NetworkError {
  constructor(message: string = 'Permission denied', provider?: string, config?: unknown) {
    super(message, 'PERMISSION_DENIED', provider, config);
    this.name = 'PermissionError';
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

/**
 * 请求错误
 */
export class RequestError extends NetworkError {
  /** HTTP 状态码 */
  readonly statusCode?: number | undefined;

  constructor(
    message: string,
    statusCode?: number,
    provider?: string,
    config?: unknown
  ) {
    super(message, 'REQUEST_ERROR', provider, config);
    this.name = 'RequestError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, RequestError.prototype);
  }
}

/**
 * 所有提供者失败错误
 */
export class AllProvidersFailedError extends NetworkError {
  /** 错误列表 */
  readonly errors: Error[];

  constructor(errors: Error[] = []) {
    super('All providers failed', 'ALL_PROVIDERS_FAILED');
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
    Object.setPrototypeOf(this, AllProvidersFailedError.prototype);
  }
}
