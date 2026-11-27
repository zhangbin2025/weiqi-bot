import type { OperatorJsonSchema } from '@domain/plugin/types';

const KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'additionalProperties',
  'description', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern',
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

export function validateSchemaDefinition(schema: OperatorJsonSchema, path = '$schema'): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`JSON Schema 必须是对象：${path}`);
  }
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`不支持的 JSON Schema 关键字：${path}.${key}`);
  }
  const type = schema['type'];
  if (type !== undefined && (typeof type !== 'string' || !TYPES.has(type))) {
    throw new Error(`JSON Schema type 不支持：${path}`);
  }
  const properties = schema['properties'];
  if (properties !== undefined) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new Error(`JSON Schema properties 必须是对象：${path}`);
    }
    for (const [key, child] of Object.entries(properties)) {
      validateSchemaDefinition(child as OperatorJsonSchema, `${path}.properties.${key}`);
    }
  }
  const required = schema['required'];
  if (required !== undefined && (!Array.isArray(required) || required.some((v) => typeof v !== 'string'))) {
    throw new Error(`JSON Schema required 必须是字符串数组：${path}`);
  }
  if (schema['items'] !== undefined) validateSchemaDefinition(schema['items'] as OperatorJsonSchema, `${path}.items`);
  const additional = schema['additionalProperties'];
  if (additional !== undefined && typeof additional !== 'boolean') {
    validateSchemaDefinition(additional as OperatorJsonSchema, `${path}.additionalProperties`);
  }
  if (schema['enum'] !== undefined && !Array.isArray(schema['enum'])) {
    throw new Error(`JSON Schema enum 必须是数组：${path}`);
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum'] as const) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`JSON Schema ${key} 必须是有限数字：${path}`);
    }
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

export function validateSchemaValue(schema: OperatorJsonSchema, value: unknown, path = '$'): string | undefined {
  const type = schema['type'];
  if (typeof type === 'string' && !matchesType(value, type)) return `${path} 应为 ${type}`;
  const values = schema['enum'];
  if (Array.isArray(values) && !values.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    return `${path} 不在允许的 enum 中`;
  }
  if (typeof value === 'string') {
    const pattern = schema['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern).test(value)) return `${path} 不符合 pattern`;
    const min = schema['minLength'];
    const max = schema['maxLength'];
    if (typeof min === 'number' && value.length < min) return `${path} 长度小于 minLength ${min}`;
    if (typeof max === 'number' && value.length > max) return `${path} 长度大于 maxLength ${max}`;
  }
  if (typeof value === 'number') {
    const min = schema['minimum'];
    const max = schema['maximum'];
    if (typeof min === 'number' && value < min) return `${path} 小于 minimum ${min}`;
    if (typeof max === 'number' && value > max) return `${path} 大于 maximum ${max}`;
  }
  if (Array.isArray(value)) {
    const min = schema['minItems'];
    const max = schema['maxItems'];
    if (typeof min === 'number' && value.length < min) return `${path} 项数小于 minItems ${min}`;
    if (typeof max === 'number' && value.length > max) return `${path} 项数大于 maxItems ${max}`;
  }
  if (Array.isArray(value) && schema['items'] && typeof schema['items'] === 'object') {
    for (let i = 0; i < value.length; i++) {
      const error = validateSchemaValue(schema['items'] as OperatorJsonSchema, value[i], `${path}[${i}]`);
      if (error) return error;
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) if (typeof key === 'string' && !(key in object)) return `${path} 缺少必填字段 ${key}`;
    }
    const properties = schema['properties'];
    const declared = properties && typeof properties === 'object' ? properties as Record<string, OperatorJsonSchema> : {};
    for (const [key, child] of Object.entries(declared)) {
      if (key in object) {
        const error = validateSchemaValue(child, object[key], `${path}.${key}`);
        if (error) return error;
      }
    }
    if (schema['additionalProperties'] === false) {
      const extra = Object.keys(object).find((key) => !(key in declared));
      if (extra !== undefined) return `${path} 包含未声明字段 ${extra}`;
    } else if (schema['additionalProperties'] && typeof schema['additionalProperties'] === 'object') {
      for (const [key, item] of Object.entries(object)) {
        if (!(key in declared)) {
          const error = validateSchemaValue(schema['additionalProperties'] as OperatorJsonSchema, item, `${path}.${key}`);
          if (error) return error;
        }
      }
    }
  }
  return undefined;
}
