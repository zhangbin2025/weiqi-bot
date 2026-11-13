/**
 * 反馈包归一与脱敏
 * @module application/plugin/FeedbackPack
 *
 * 把沙箱执行结果压成「既够模型定位问题、又不泄漏真实数据」的反馈包。
 * 关键：只给形状摘要，不把选手姓名、id、真实分数数列回喂给 LLM。
 */

import type { PluginRunResult, RepairFeedback, PluginError } from '@domain/plugin/types';

const DEFAULT_MAX_CHARS = 1200;
const MAX_MESSAGE = 300;
const MAX_STACK = 400;

/** 把任意输入压成「字段 + 长度」摘要，绝不输出值 */
export function describeInputShape(input: unknown): string {
  if (input === null) return 'null';
  if (input === undefined) return 'undefined';
  if (Array.isArray(input)) {
    const first = input[0];
    const keys = first && typeof first === 'object' && !Array.isArray(first)
      ? Object.keys(first as Record<string, unknown>).sort().join(',')
      : 'scalar';
    return `Array<${input.length}item> of {${keys}}`;
  }
  if (typeof input === 'object') {
    return `Object{${Object.keys(input as Record<string, unknown>).sort().join(',')}}`;
  }
  return typeof input;
}

/** 按阶段给出比原始报错更利于收敛的人话提示 */
function hintFor(result: Extract<PluginRunResult, { ok: false }>): string {
  switch (result.phase) {
    case 'compile':
      return '源码有语法错误，请检查括号、引号和函数定义后输出完整代码';
    case 'runtime':
      return '运行时抛错，请检查字段是否可能 undefined、数组是否越界';
    case 'contract':
      return result.contract?.missingFields.length
        ? `排名表不符合契约（${result.contract.missingFields.join(',')}）：必须返回 { columns, rows } 对象，列名为汉字，cells 只能是数值或数值数组`
        : (result.hint ?? '入口或返回值不符合契约，必须返回 { columns, rows } 对象且 cells 为数值或数值数组');
    case 'timeout':
      return '执行超时，请避免死循环与 O(n²) 以上的复杂度';
    case 'oom':
      return '内存超限，请不要在插件里构造大数组或深拷贝';
    case 'crash':
      return '沙箱崩溃，请简化实现';
    case 'user':
      return '用户验收未通过，请按反馈重写完整代码';
    default:
      return '请根据错误修正后输出完整代码';
  }
}

/** 从沙箱结果生成反馈包 */
export function toFeedback(
  runResult: PluginRunResult,
  attempt: number,
  maxAttempts: number,
  inputShape?: string,
): RepairFeedback {
  if (runResult.ok) {
    return { phase: 'runtime', ok: false, attempt, maxAttempts };
  }
  const fb: RepairFeedback = {
    phase: runResult.phase,
    ok: false,
    ...(runResult.error ? { error: runResult.error } : {}),
    hint: runResult.hint ?? hintFor(runResult),
    attempt,
    maxAttempts,
  };
  if (runResult.contract) fb.contract = runResult.contract;
  if (inputShape !== undefined) fb.inputShape = inputShape;
  return fb;
}

/** 去掉字符串里疑似真实数据的长串（连续数字/长 token），并控制长度 */
function redactInline(text: string, maxChars: number): string {
  return text
    // 长数字串（分数/账号/时间戳等）
    .replace(/\d{6,}/g, '[n]')
    // 长十六进制 / base64 样式 token
    .replace(/[A-Za-z0-9+/=]{24,}/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function sanitizeError(error: PluginError | undefined, budget: number): PluginError | undefined {
  if (!error) return undefined;
  const out: PluginError = {
    name: redactInline(error.name, 80),
    message: redactInline(error.message, Math.min(MAX_MESSAGE, budget)),
  };
  if (error.stack !== undefined) {
    out.stack = redactInline(error.stack, MAX_STACK);
  }
  if (error.lineNumber !== undefined) out.lineNumber = error.lineNumber;
  return out;
}

/**
 * 脱敏 + 截断。总长度受 maxChars 控制，超出时优先保留错误与提示。
 * 不修改入参。
 */
export function sanitizeFeedback(fb: RepairFeedback, maxChars: number = DEFAULT_MAX_CHARS): RepairFeedback {
  const budget = Math.max(200, Math.min(maxChars, 4000));
  const out: RepairFeedback = {
    phase: fb.phase,
    ok: false,
    attempt: fb.attempt,
    maxAttempts: fb.maxAttempts,
  };

  const error = sanitizeError(fb.error, Math.floor(budget / 3));
  if (error) out.error = error;
  if (fb.contract) out.contract = { ...fb.contract, missingFields: fb.contract.missingFields.slice(0, 12) };
  if (fb.hint) out.hint = redactInline(fb.hint, 300);
  if (fb.inputShape) out.inputShape = redactInline(fb.inputShape, 200);
  if (fb.userText) out.userText = redactInline(fb.userText, 300);

  // 序列化后总长兜底：逐项裁掉非关键字段直到装得下
  const serialized = (): number => JSON.stringify(out).length;
  if (serialized() > budget && out.error?.stack !== undefined) delete out.error.stack;
  if (serialized() > budget && out.userText !== undefined) delete out.userText;
  if (serialized() > budget && out.hint !== undefined) delete out.hint;
  if (serialized() > budget && out.error) {
    out.error.message = out.error.message.slice(0, 120);
  }
  return out;
}
