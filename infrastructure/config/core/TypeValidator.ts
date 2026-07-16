/**
 * 类型验证辅助方法
 */

import type { IConfigSchemaField } from '../interfaces';

export class TypeValidator {
  static validateType(key: string, value: unknown, field: IConfigSchemaField): string | null {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    switch (field.type) {
      case 'string':
        if (typeof value !== 'string') return `Field '${key}' must be a string, got ${actualType}`;
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) return `Field '${key}' must be a number, got ${actualType}`;
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return `Field '${key}' must be a boolean, got ${actualType}`;
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return `Field '${key}' must be an object, got ${actualType}`;
        break;
      case 'array':
        if (!Array.isArray(value)) return `Field '${key}' must be an array, got ${actualType}`;
        break;
    }
    return null;
  }

  static validateEnum(key: string, value: unknown, field: IConfigSchemaField): string | null {
    if (field.type === 'enum' && field.enumValues && !field.enumValues.includes(value)) {
      return `Field '${key}' must be one of: ${field.enumValues.join(', ')}`;
    }
    return null;
  }

  static validateNumberRange(key: string, value: unknown, field: IConfigSchemaField): string[] {
    const errors: string[] = [];
    if (field.type === 'number' && typeof value === 'number') {
      if (field.minValue !== undefined && value < field.minValue) {
        errors.push(`Field '${key}' must be >= ${field.minValue}, got ${value}`);
      }
      if (field.maxValue !== undefined && value > field.maxValue) {
        errors.push(`Field '${key}' must be <= ${field.maxValue}, got ${value}`);
      }
    }
    return errors;
  }

  static validateLength(key: string, value: unknown, field: IConfigSchemaField): string[] {
    const errors: string[] = [];
    if (field.type === 'string' && typeof value === 'string') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push(`Field '${key}' must be at least ${field.minLength} characters`);
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push(`Field '${key}' must be at most ${field.maxLength} characters`);
      }
    }
    if (field.type === 'array' && Array.isArray(value)) {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push(`Field '${key}' must have at least ${field.minLength} items`);
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push(`Field '${key}' must have at most ${field.maxLength} items`);
      }
    }
    return errors;
  }
}
