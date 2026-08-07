import { ConfigValidator } from '../core/ConfigValidator';

describe('ConfigValidator', () => {
  it('should validate required fields', () => {
    const schema = { key: { type: 'string', required: true } };
    const result = ConfigValidator.validate({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Field 'key' is required");
  });

  it('should validate types', () => {
    const schema = { key: { type: 'string' } };
    const result = ConfigValidator.validate({ key: 123 }, schema);
    expect(result.valid).toBe(false);
  });

  it('should validate enums', () => {
    const schema = { key: { type: 'enum', enumValues: ['a', 'b'] } };
    const result = ConfigValidator.validate({ key: 'c' }, schema);
    expect(result.valid).toBe(false);
  });

  it('should pass valid config', () => {
    const schema = { key: { type: 'string', default: 'value' } };
    const result = ConfigValidator.validate({ key: 'value' }, schema);
    expect(result.valid).toBe(true);
  });
});
