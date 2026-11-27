import { describe, it, expect, vi } from 'vitest';
import { buildSkillToolParts } from '../SkillRegistry';
import type { SkillPrimitive, SkillRecipe } from '../SkillTypes';

const recipe: SkillRecipe = {
  schemaVersion: 1,
  id: 'test.structured',
  version: 1,
  name: 'structured',
  summary: 'structured args',
  primitives: ['echo'],
  prompt: 'test',
};

describe('buildSkillToolParts', () => {
  it('在 Tool Calling 边界解析 JSON 一次，再把对象交给 primitive', async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => ({
      observation: 'ok',
      ok: true,
      detail: 'ok',
      value: args,
    }));
    const primitive: SkillPrimitive = {
      name: 'echo',
      definition: {
        name: 'echo',
        description: 'echo',
        parameters: { type: 'object' },
      },
      idempotent: true,
      outputSchema: {},
      kind: 'pure',
      execute,
    };
    const parts = buildSkillToolParts([recipe], new Map([['echo', primitive]]));
    const payload = { nested: { value: 42 } };
    await parts.executors['echo']!(JSON.stringify(payload));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(payload);
  });

  it('拒绝非对象的 Tool Calling 参数', async () => {
    const primitive: SkillPrimitive = {
      name: 'echo',
      definition: { name: 'echo', description: 'echo', parameters: { type: 'object' } },
      idempotent: true,
      outputSchema: {},
      kind: 'pure',
      execute: vi.fn(async () => ({ observation: 'ok', ok: true, detail: 'ok' })),
    };
    const parts = buildSkillToolParts([recipe], new Map([['echo', primitive]]));
    await expect(parts.executors['echo']!('[]')).rejects.toThrow('工具参数必须是 JSON 对象');
  });
});
