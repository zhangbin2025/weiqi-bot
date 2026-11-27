import { describe, it, expect } from 'vitest';
import { validateOperatorContract } from '../OperatorContract';

const valid = {
  exposes: [{
    name: 'collect',
    description: 'Collect records',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
      additionalProperties: false,
    },
    outputSchema: { type: 'array' },
    kind: 'io',
    idempotent: true,
  }],
  smoke: [{ method: 'collect', args: [{ ids: ['a', 'b'] }], expect: [] }],
};

describe('workflow-operator strict contract', () => {
  it('接受完整的输入/输出 Schema、kind 和幂等性声明', () => {
    expect(validateOperatorContract(valid)).toBeUndefined();
  });

  it('拒绝缺少 inputSchema 或 outputSchema 的旧 exposes 声明', () => {
    const { inputSchema: _input, ...withoutInput } = valid.exposes[0]!;
    expect(validateOperatorContract({
      exposes: [withoutInput],
      smoke: valid.smoke,
    })).toContain('inputSchema');
    const { outputSchema: _output, ...withoutOutput } = valid.exposes[0]!;
    expect(validateOperatorContract({
      exposes: [withoutOutput],
      smoke: valid.smoke,
    })).toContain('outputSchema');
  });

  it('在插件自检阶段校验 smoke 参数', () => {
    expect(validateOperatorContract({
      ...valid,
      smoke: [{ method: 'collect', args: [{ ids: [1] }], expect: [] }],
    })).toContain('inputSchema');
  });
});
