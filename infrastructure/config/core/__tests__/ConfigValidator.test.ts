/**
 * ConfigValidator 外部接口测试
 */

import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../ConfigValidator';
import type { IConfigSchemaDefinition } from '../../interfaces';

describe('ConfigValidator 外部接口', () => {
  describe('validate()', () => {
    it('should return valid for correct config', () => {
      const schema: IConfigSchemaDefinition<{ name: string }> = {
        name: { type: 'string' }
      };
      const result = ConfigValidator.validate({ name: 'test' }, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return invalid for missing required field', () => {
      const schema: IConfigSchemaDefinition<{ name: string }> = {
        name: { type: 'string', required: true }
      };
      const result = ConfigValidator.validate({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length > 0);
    });

    it('should return invalid for wrong type', () => {
      const schema: IConfigSchemaDefinition<{ count: number }> = {
        count: { type: 'number' }
      };
      const result = ConfigValidator.validate({ count: 'not-a-number' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('number')));
    });

    it('should validate nested object', () => {
      const schema: IConfigSchemaDefinition<{ db: { host: string; port: number } }> = {
        db: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'number' }
          }
        }
      };
      const result = ConfigValidator.validate({ db: { host: 'localhost', port: 'abc' } }, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate array items', () => {
      const schema: IConfigSchemaDefinition<{ items: number[] }> = {
        items: { type: 'array', items: { type: 'number' } }
      };
      const result = ConfigValidator.validate({ items: [1, 'a', 2] }, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate enum values', () => {
      const schema: IConfigSchemaDefinition<{ level: string }> = {
        level: { type: 'enum', enumValues: ['low', 'medium', 'high'] }
      };
      const result = ConfigValidator.validate({ level: 'unknown' }, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate number range', () => {
      const schema: IConfigSchemaDefinition<{ port: number }> = {
        port: { type: 'number', minValue: 1, maxValue: 65535 }
      };
      const result = ConfigValidator.validate({ port: 80000 }, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate string length', () => {
      const schema: IConfigSchemaDefinition<{ code: string }> = {
        code: { type: 'string', minLength: 4, maxLength: 8 }
      };
      const result = ConfigValidator.validate({ code: 'abc' }, schema);
      expect(result.valid).toBe(false);
    });
  });
});