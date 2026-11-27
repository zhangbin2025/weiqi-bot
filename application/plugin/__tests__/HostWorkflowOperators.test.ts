import { describe, expect, it } from 'vitest';
import { createHostWorkflowOperators } from '../HostWorkflowOperators';
import { executeRegex } from '@infrastructure/workflow/regexCore';

describe('host-native Workflow JSON / regex operators', () => {
  const operators = new Map(createHostWorkflowOperators({
    // Operator contract tests exercise argument/result semantics; worker lifecycle is tested separately.
    regexRunner: async (method, args) => executeRegex(method, args),
  }).map((operator) => [operator.name, operator] as const));

  it('keeps the existing json.* and regex.* call names and data contracts', async () => {
    const parsed = await operators.get('json.parse')!.run({ text: '{"items":[{"uid":7},{"uid":8}]}' });
    expect(parsed.value).toEqual({ items: [{ uid: 7 }, { uid: 8 }] });

    const selected = await operators.get('json.select')!.run({
      items: (parsed.value as { items: unknown[] }).items,
      where: { uid: { stringEq: '8' } },
      pick: ['uid'],
    });
    expect(selected.value).toEqual([{ uid: 8 }]);

    const extracted = await operators.get('regex.extract')!.run({
      text: 'x12 y34', pattern: '\\d+', withIndex: true,
    });
    expect(extracted.value).toEqual([
      { value: '12', index: 1 },
      { value: '34', index: 5 },
    ]);
  });

  it('rejects prototype-sensitive paths and enforces regex input bounds', async () => {
    await expect(operators.get('json.get')!.run({ value: {}, path: '__proto__.polluted' }))
      .rejects.toThrow('保留属性');
    await expect(operators.get('regex.match')!.run({
      text: 'a'.repeat(100_001), pattern: 'a+',
    })).rejects.toThrow('最长');
  });
});
