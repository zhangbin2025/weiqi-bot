/**
 * 配置验证器
 */

import type { IConfigSchemaDefinition, IConfigSchemaField } from '../interfaces';
import { TypeValidator } from './TypeValidator';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ConfigValidator {
  static validate<T>(config: Partial<T>, schema: IConfigSchemaDefinition<T>): ValidationResult {
    const errors: string[] = [];
    for (const [key, field] of Object.entries(schema)) {
      const value = (config as any)[key];
      errors.push(...this.validateField(key, value, field as IConfigSchemaField<unknown>));
    }
    return { valid: errors.length === 0, errors };
  }

  private static validateField(key: string, value: unknown, field: IConfigSchemaField): string[] {
    const errors: string[] = [];
    if (field.required && value === undefined) return [`Field '${key}' is required`];
    if (value === undefined) return errors;

    const typeError = TypeValidator.validateType(key, value, field);
    if (typeError) return [typeError];

    const enumError = TypeValidator.validateEnum(key, value, field);
    if (enumError) errors.push(enumError);
    errors.push(...TypeValidator.validateNumberRange(key, value, field));
    errors.push(...TypeValidator.validateLength(key, value, field));

    if ((field as { type: string }).type === 'array' && Array.isArray(value) && field.items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...this.validateField(`${key}[${i}]`, value[i], field.items as IConfigSchemaField<unknown>));
      }
    }

    if ((field as { type: string }).type === 'object' && field.properties && typeof value === 'object') {
      for (const [subKey, subField] of Object.entries(field.properties)) {
        errors.push(...this.validateField(`${key}.${subKey}`, (value as any)[subKey], subField as IConfigSchemaField<unknown>));
      }
    }

    if (field.validate) {
      try {
        if (!field.validate(value)) errors.push(`Field '${key}' failed custom validation`);
      } catch (error) {
        errors.push(`Field '${key}' validation error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return errors;
  }
}
