/**
 * 错误处理工具
 */

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class TaskError extends AppError {
  constructor(message: string, taskId?: string, details?: any) {
    super(message, 'TASK_ERROR', { taskId, ...details });
    this.name = 'TaskError';
  }
}

export class KatagoError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'KATAGO_ERROR', details);
    this.name = 'KatagoError';
  }
}

export class SnifferError extends AppError {
  constructor(message: string, sessionId?: string, details?: any) {
    super(message, 'SNIFFER_ERROR', { sessionId, ...details });
    this.name = 'SnifferError';
  }
}

/**
 * 安全执行异步函数
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  errorHandler?: (error: Error) => T
): Promise<T | null> {
  try {
    return await fn();
  } catch (error: any) {
    console.error('[SafeAsync] Error:', error.message);
    if (errorHandler) {
      return errorHandler(error);
    }
    return null;
  }
}

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.warn(`[Retry] Attempt ${i + 1}/${maxRetries} failed:`, error.message);
      
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Retry failed');
}
