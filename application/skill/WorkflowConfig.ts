/**
 * Workflow 执行资源限制配置。
 *
 * 三项限制均为宿主保护阈值，不属于技能 DSL 语义：
 * - 单个循环迭代上限：同时约束 forEach 项数与 repeat.maxIterations；
 * - 单次 Workflow 累计循环上限：forEach / repeat 的每次迭代统一累计；
 * - 控制块嵌套深度：forEach / repeat / ifElse 每进入一层计一层。
 *
 * 默认 null 表示不限制。配置持久化到 localStorage；不可用时使用进程内兜底。
 */
export type WorkflowLimitKey = 'maxIterationsPerLoop' | 'maxTotalIterations' | 'maxNestingDepth';

export interface WorkflowLimits {
  maxIterationsPerLoop: number | null;
  maxTotalIterations: number | null;
  maxNestingDepth: number | null;
}

const STORAGE_KEYS: Record<WorkflowLimitKey, string> = {
  maxIterationsPerLoop: 'weiqi.workflow.maxIterationsPerLoop',
  maxTotalIterations: 'weiqi.workflow.maxTotalIterations',
  maxNestingDepth: 'weiqi.workflow.maxNestingDepth',
};

const DEFAULT_LIMITS: WorkflowLimits = {
  maxIterationsPerLoop: null,
  maxTotalIterations: null,
  maxNestingDepth: null,
};

let memoryValues: Partial<WorkflowLimits> = {};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 正整数表示限制值；null 表示不限制。非法持久化值回退为默认不限制。 */
function parseLimit(raw: string | null, fallback: number | null): number | null {
  if (raw === null) return fallback;
  if (raw === 'off') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function loadWorkflowLimits(): WorkflowLimits {
  const s = storage();
  const result = {} as WorkflowLimits;
  for (const key of Object.keys(STORAGE_KEYS) as WorkflowLimitKey[]) {
    if (!s) {
      result[key] = memoryValues[key] ?? DEFAULT_LIMITS[key];
      continue;
    }
    try {
      result[key] = parseLimit(s.getItem(STORAGE_KEYS[key]), memoryValues[key] ?? DEFAULT_LIMITS[key]);
    } catch {
      result[key] = memoryValues[key] ?? DEFAULT_LIMITS[key];
    }
  }
  return result;
}

export function saveWorkflowLimit(key: WorkflowLimitKey, value: number | null): void {
  const normalized = value === null
    ? null
    : (Number.isSafeInteger(value) && value > 0 ? value : null);
  memoryValues = { ...memoryValues, [key]: normalized };
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEYS[key], normalized === null ? 'off' : String(normalized));
  } catch { /* 隐私模式下写不进去，内存值仍生效 */ }
}

/** 仅供测试：清除内存兜底值和持久化配置。 */
export function resetWorkflowLimitsForTest(): void {
  memoryValues = {};
  const s = storage();
  if (!s) return;
  for (const key of Object.keys(STORAGE_KEYS) as WorkflowLimitKey[]) {
    try { s.removeItem(STORAGE_KEYS[key]); } catch { /* ignore */ }
  }
}
