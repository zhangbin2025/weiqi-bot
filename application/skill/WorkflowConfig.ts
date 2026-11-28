/**
 * Workflow 执行资源限制配置。
 * @module application/skill/WorkflowConfig
 *
 * 三项限制均为宿主保护阈值，不属于技能 DSL 语义：
 * - 单个循环迭代上限：同时约束 forEach 项数与 repeat.maxIterations；
 * - 单次 Workflow 累计循环上限：forEach / repeat 的每次迭代统一累计；
 * - 控制块嵌套深度：forEach / repeat / ifElse 每进入一层计一层。
 *
 * ⚠️ 数值来源（经验值，不是物理/几何推导、不是统计分位数）：
 * - maxIterationsPerLoop = 100、maxTotalIterations = 500：沿用本次改动前
 *   WorkflowRunner.ts 里既有的两个硬编码宿主资源预算常量，未重新调参；
 * - maxNestingDepth = 100：与单循环预算同量级的「明显够大」整数，仅供兜住
 *   病态深层嵌套；配方正常嵌套层数远小于它。
 * 三者都标注为经验值，可用 `/llm workflow-*` 改成任意正整数或 off 关闭，
 * 不得把这些数包装成「约束边界 / 自然边界」。
 *
 * 默认均为有限正整数（不是 null），保证宿主始终有资源护栏；off 才不限制。
 * 配置持久化到 localStorage；不可用时使用进程内兜底。
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

/** 经验值：前两项沿用旧 Runner 常量；深度取同量级兜底值。见文件头「数值来源」。 */
const DEFAULT_LIMITS: WorkflowLimits = {
  maxIterationsPerLoop: 100,
  maxTotalIterations: 500,
  maxNestingDepth: 100,
};

/** 无 localStorage 或持久化值损坏时的内存兜底（按 key 独立记录）。 */
let memoryValues: Partial<Record<WorkflowLimitKey, number | null>> = {};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 解析持久化值：'off' → null（不限制）；正整数 → 原值；其余非法值 → 回退到
 * 该 key 的内存值（若有），再回退到默认经验值。
 * 与 saveWorkflowLimit 对称：写失败/写不进去时内存值优先，不会被坏 storage 覆盖。
 */
function parseLimit(raw: string | null, fallback: number | null): number | null {
  if (raw === null) return fallback;
  if (raw.toLowerCase() === 'off') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function fallbackFor(key: WorkflowLimitKey): number | null {
  return Object.prototype.hasOwnProperty.call(memoryValues, key)
    ? memoryValues[key] ?? null
    : DEFAULT_LIMITS[key];
}

export function loadWorkflowLimits(): WorkflowLimits {
  const s = storage();
  const result = {} as WorkflowLimits;
  for (const key of Object.keys(STORAGE_KEYS) as WorkflowLimitKey[]) {
    if (!s) {
      result[key] = fallbackFor(key);
      continue;
    }
    try {
      result[key] = parseLimit(s.getItem(STORAGE_KEYS[key]), fallbackFor(key));
    } catch {
      result[key] = fallbackFor(key);
    }
  }
  return result;
}

export function saveWorkflowLimit(key: WorkflowLimitKey, value: number | null): void {
  // null = off（显式不限制）；非法输入收敛为 null，命令层另有校验。
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

/** 仅供测试：清除内存兜底值和持久化配置，恢复到默认经验值。 */
export function resetWorkflowLimitsForTest(): void {
  memoryValues = {};
  const s = storage();
  if (!s) return;
  for (const key of Object.keys(STORAGE_KEYS) as WorkflowLimitKey[]) {
    try { s.removeItem(STORAGE_KEYS[key]); } catch { /* ignore */ }
  }
}
