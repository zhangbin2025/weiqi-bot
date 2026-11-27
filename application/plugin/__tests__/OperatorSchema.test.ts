import { describe, it, expect } from 'vitest';
import { validateSchemaDefinition, validateSchemaValue } from '../OperatorSchema';

describe('OperatorSchema', () => {
  it('验证 schema 声明并拒绝未实现的关键字', () => {
    expect(() => validateSchemaDefinition({
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    })).not.toThrow();
    expect(() => validateSchemaDefinition({ type: 'object', oneOf: [] }))
      .toThrow('不支持的 JSON Schema 关键字');
  });

  it('递归验证输入对象、数组和额外字段', () => {
    const schema = {
      type: 'object',
      properties: {
        records: { type: 'array', minItems: 1, items: { type: 'object' } },
      },
      required: ['records'],
      additionalProperties: false,
    };
    expect(validateSchemaValue(schema, { records: [{ id: 1 }] })).toBeUndefined();
    expect(validateSchemaValue(schema, { records: [] })).toContain('minItems');
    expect(validateSchemaValue(schema, { records: [], extra: true })).toContain('未声明字段');
  });

  it('验证输出值的类型和数值范围', () => {
    expect(validateSchemaValue({ type: 'integer', minimum: 1 }, 2)).toBeUndefined();
    expect(validateSchemaValue({ type: 'integer', minimum: 1 }, 0)).toContain('minimum');
    expect(validateSchemaValue({ type: 'string' }, null)).toContain('应为 string');
  });
});
