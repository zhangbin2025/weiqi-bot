/**
 * 指令满足度验证器测试
 *
 * 覆盖：判定解析（严格布尔、围栏/前后废话容错）、验收依据只认 instruction、
 * 调用失败/解析不了时 available=false（fail-open，不打回正确代码）。
 */

import { describe, it, expect, vi } from 'vitest';
import { InstructionVerifier } from '../InstructionVerifier';
import type { IModelGateway, ModelRequest } from '@application/model/IModelGateway';

const req = {
  spec: '原始需求：按积分排名',
  instruction: '不对，总分不该是积分加对手分，请按积分编排制重算',
  previousCode: 'function rank(x){ return x }',
  candidateCode: 'function rank(x){ return { columns:[], rows:[], fixed:true } }',
};

function gateway(text: string): { g: IModelGateway; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({ text, truncated: false });
  return { g: { isReady: () => true, execute } as unknown as IModelGateway, execute };
}

describe('InstructionVerifier', () => {
  it('模型判满足 → available=true / satisfied=true', async () => {
    const { g, execute } = gateway('{"satisfied":true,"reason":""}');
    const r = await new InstructionVerifier(g).verify(req);
    expect(r).toEqual({ satisfied: true, reason: '', available: true });
    // 验收依据（本轮指令）与四元全部进消息
    const call = execute.mock.calls[0]![0] as ModelRequest;
    expect(call.task).toBe('plugin.generate');
    expect(call.options?.jsonMode).toBe(true);
    const all = call.messages.map((m) => m.content).join('\n');
    expect(all).toContain(req.instruction);
    expect(all).toContain('验收依据');
    expect(all).toContain(req.previousCode);
    expect(all).toContain(req.candidateCode);
    expect(all).toContain(req.spec);
  });

  it('模型判不满足 → 带上「还差什么」reason', async () => {
    const { g } = gateway('```json\n{"satisfied":false,"reason":"仍把总分算成积分+对手分"}\n```');
    const r = await new InstructionVerifier(g).verify(req);
    expect(r.available).toBe(true);
    expect(r.satisfied).toBe(false);
    expect(r.reason).toContain('积分+对手分');
  });

  it('前后废话 + 围栏也能抠出判定', async () => {
    const { g } = gateway('让我想想…\n```json\n{"satisfied":true,"reason":"ok"}\n```\n以上。');
    const r = await new InstructionVerifier(g).verify(req);
    expect(r.available).toBe(true);
    expect(r.satisfied).toBe(true);
  });

  it('字符串 "true" 不采信 → available=false（不把含糊当通过）', async () => {
    const { g } = gateway('{"satisfied":"true","reason":"应该是改了"}');
    const r = await new InstructionVerifier(g).verify(req);
    expect(r.available).toBe(false);
    expect(r.reason).toContain('未能给出可采信');
  });

  it('纯解释文字无 JSON → available=false', async () => {
    const { g } = gateway('我觉得大概改好了吧。');
    const r = await new InstructionVerifier(g).verify(req);
    expect(r.available).toBe(false);
  });

  it('网关抛错 → available=false 且 reason 标明不据此打回', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('网络超时'));
    const g = { isReady: () => true, execute } as unknown as IModelGateway;
    const r = await new InstructionVerifier(g).verify(req);
    expect(r.available).toBe(false);
    expect(r.reason).toContain('不据此打回');
    expect(r.reason).toContain('网络超时');
  });

  it('system 明确「判定依据只能是本轮修改要求」，不另立业务标准', async () => {
    const { g, execute } = gateway('{"satisfied":true,"reason":""}');
    await new InstructionVerifier(g).verify(req);
    const call = execute.mock.calls[0]![0] as ModelRequest;
    const system = call.messages[0]!.content as string;
    expect(system).toContain('判定依据只能是');
    expect(system).toContain('不要凭你对业务的理解另立标准');
    expect(system).toContain('能否运行');
  });
});
