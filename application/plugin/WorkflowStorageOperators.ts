/**
 * Workflow-only storage operators backed by the existing KvService.
 *
 * They are deliberately not SkillPrimitives: LLM continues to use kv_read /
 * kv_write / kv_delete, while Workflow calls this thin host adapter.
 */
import type { OperatorSpec } from '@domain/plugin/types';
import { KV_KEY_RE, type KvService } from '@application/skill/kv/KvService';

const OBJECT_SCHEMA = { type: 'object' } as const;

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value;
}

function resolveDomain(kv: KvService, name: string, write: boolean) {
  const domain = kv.domains().find((item) => item.name === name);
  if (!domain) throw new Error(`未知存储域：${name}`);
  if (domain.visibility !== 'readable') {
    throw new Error(`存储域 ${name} 不允许 Workflow 读取或修改`);
  }
  if (write && domain.writableBy === 'host') {
    throw new Error(`存储域 ${name} 仅允许宿主内部写入`);
  }
  return domain;
}

function operator(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  idempotent: boolean,
  run: (args: Record<string, unknown>) => Promise<unknown>,
): OperatorSpec {
  return {
    name,
    description,
    kind: 'io',
    idempotent,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    outputSchema: {},
    run: async (args) => ({ value: await run(args) }),
  };
}

/**
 * Reuse KvService's existing domain policy, key validation, serialization,
 * physical-key mapping and storage driver. No separate storage implementation.
 */
export function createWorkflowStorageOperators(kv: KvService): OperatorSpec[] {
  const domainProperty = {
    type: 'string',
    description: '已注册的存储域名称，例如 prefs',
  };
  const keyProperty = {
    type: 'string',
    description: '存储键；遵循 KvService 现有键名规则',
  };

  return [
    operator(
      'storage.get',
      '读取已注册且可读的本地存储域。不存在的键返回 null；敏感域和宿主独占域不可访问。',
      { domain: domainProperty, key: keyProperty },
      ['domain', 'key'],
      true,
      async (args) => {
        const domain = requiredString(args, 'domain');
        const key = requiredString(args, 'key');
        resolveDomain(kv, domain, false);
        if (!KV_KEY_RE.test(key)) throw new Error('key 不合法');
        return kv.readRaw(domain, key);
      },
    ),
    operator(
      'storage.set',
      '写入已注册、可读且允许模型写入的本地存储域；复用 KvService 的序列化与域配额策略。',
      {
        domain: domainProperty,
        key: keyProperty,
        value: { description: '要保存的 JSON 值' },
      },
      ['domain', 'key', 'value'],
      true,
      async (args) => {
        const domain = requiredString(args, 'domain');
        const key = requiredString(args, 'key');
        resolveDomain(kv, domain, true);
        const result = await kv.put(domain, key, args['value']);
        if (!result.ok) throw new Error(result.reason ?? '存储写入失败');
        return args['value'];
      },
    ),
    operator(
      'storage.delete',
      '删除已注册、可读且允许模型写入的本地存储键；重复删除结果不变。',
      { domain: domainProperty, key: keyProperty },
      ['domain', 'key'],
      true,
      async (args) => {
        const domain = requiredString(args, 'domain');
        const key = requiredString(args, 'key');
        resolveDomain(kv, domain, true);
        if (!KV_KEY_RE.test(key)) throw new Error('key 不合法');
        await kv.remove(domain, key);
        return true;
      },
    ),
  ];
}
