/**
 * 指令满足度验证器（生成→验证→修订闭环里的 verifier）
 * @module application/plugin/InstructionVerifier
 *
 * 标准做法（Self-Refine / Reflexion 形状）：代码「能跑、合契约」只是必要条件，
 * 「是否按本轮修改要求改了」需要单独验收。这里用一次独立模型调用做判定，
 * 判定结果回喂给 codegen 触发下一轮修订。
 *
 * 边界：
 * - 只在「修订」时由 codegen 调用；首次生成没有「改动」可验，不增加这次调用。
 * - 判定不是 100% 可靠：只有模型明确判「不满足」才回环；调用失败 / 解析不了时
 *   available=false，调用方 fail-open（不因验证器自身问题打回正确代码），
 *   但把「未判定」显式暴露在 trace 里，用户可见，不静默当成功。
 * - satisfied / available 都是布尔（模型判定 / 事实），不含任何经验阈值或口径常数。
 * - 判定依据严格限定为【本轮修改要求】原文，不让模型另立业务标准：
 *   术语口径（如「总分」怎么算）仍由用户给出，验证器不替用户拍板。
 */

import type { IModelGateway, ModelMessage } from '@application/model/IModelGateway';

/** 验证请求：四元里的 spec / instruction / state / state' 全给齐 */
export interface VerificationRequest {
  /** 原始需求（spec），仅作背景 */
  spec: string;
  /** 本轮增量指令，验收的唯一依据（用户原话，不脱敏、不转述） */
  instruction: string;
  /** 修改前源码（state） */
  previousCode: string;
  /** 候选源码（state'） */
  candidateCode: string;
}

export interface VerificationResult {
  /** 模型是否判定「已按本轮指令完成改动」 */
  satisfied: boolean;
  /** 不满足时，面向代码生成器说明「还差什么」（回喂文本） */
  reason: string;
  /** 本次是否真的拿到了可采信的判定；false 时 satisfied 无意义 */
  available: boolean;
}

/** 端口：便于测试注入 mock，也便于以后替换为别的判定实现 */
export interface IInstructionVerifier {
  verify(req: VerificationRequest): Promise<VerificationResult>;
}

/**
 * 从模型文本里取 { satisfied, reason }。
 * 解析不了返回 undefined（→ available=false），不把废话硬解释成判定。
 */
function parseVerdict(raw: string): { satisfied: boolean; reason: string } | undefined {
  const trimmed = raw.trim();
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  candidates.push(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Record<string, unknown>;
      // 只认布尔；字符串 "true" 一律不采信，避免模型含糊其辞被当成通过
      if (typeof obj['satisfied'] === 'boolean') {
        return {
          satisfied: obj['satisfied'],
          reason: typeof obj['reason'] === 'string' ? obj['reason'] : '',
        };
      }
    } catch { /* 试下一个候选 */ }
  }
  return undefined;
}

export class InstructionVerifier implements IInstructionVerifier {
  constructor(private readonly gateway: IModelGateway) {}

  async verify(req: VerificationRequest): Promise<VerificationResult> {
    const system = [
      '你是一个代码审查员，只做一件事：判断「候选源码」是否按【本轮修改要求】相对【修改前源码】做了实质改动并满足该要求。',
      '判定依据只能是【本轮修改要求】原文；不要凭你对业务的理解另立标准，也不要用「能否运行 / 是否合契约」代替「是否按指令改了」。',
      '只输出严格 JSON：{"satisfied":true/false,"reason":"..."}。satisfied=false 时 reason 必须写清「还差什么」，供生成器下一轮直接照着改。',
      '不要输出解释文字，也不要输出代码。',
    ].join('\n');

    // 前后源码都受工件体积上限约束（validator 已保证），这里不另立截断阈值。
    const user = [
      `【本轮修改要求（验收依据，原样）】\n${req.instruction}`,
      `【原始需求（仅作背景）】\n${req.spec}`,
      `【修改前源码】\n\`\`\`js\n${req.previousCode}\n\`\`\``,
      `【候选源码】\n\`\`\`js\n${req.candidateCode}\n\`\`\``,
      '请判定候选源码是否严格按【本轮修改要求】完成了改动，输出 {satisfied, reason}。',
    ].join('\n\n');

    const messages: ModelMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let raw: string;
    try {
      const result = await this.gateway.execute({
        // 复用已在网关白名单里的任务，不改基础设施
        task: 'plugin.generate',
        messages,
        options: { jsonMode: true },
      });
      raw = result.text;
    } catch (error) {
      return {
        satisfied: false,
        available: false,
        reason: `验证器调用失败（不据此打回）：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const verdict = parseVerdict(raw);
    if (!verdict) {
      return {
        satisfied: false,
        available: false,
        reason: '验证器未能给出可采信的判定（不据此打回）',
      };
    }
    return { satisfied: verdict.satisfied, reason: verdict.reason, available: true };
  }
}
