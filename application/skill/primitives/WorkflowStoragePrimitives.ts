/**
 * 宿主 Workflow 存储算子。
 *
 * 与 LLM 的 kv_* 工具完全分离：只由 Workflow OperatorRegistry 调用，
 * 不进入模型工具注册表；底层复用同一个 KvService / 域策略 / 持久化驱动。
 */
import type { KvService } from '@application/skill/kv/KvService';
import type { PrimitiveResult, SkillPrimitive } from '@application/skill/SkillTypes';

type StorageRun = (args: Record<string, unknown>) => Promise<unknown>;

const BASE_PROPERTIES = {
  domain: { type: 'string', description: '逻辑存储域名' },
  key: { type: 'string', description: '域内存储键' },
} as const;

function storagePrimitive(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  run: StorageRun,
): SkillPrimitive {
  return {
    name,
    definition: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
    idempotent: true,
    workflowOnly: true,
    outputSchema: {},
    kind: 'io',
    execute: async (args): Promise<PrimitiveResult> => {
      try {
        const value = await run(args);
        return { observation: `${name} 完成`, ok: true, detail: `${name} 完成`, value };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { observation: `${name} 失败：${reason}`, ok: false, detail: reason };
      }
    },
  };
}

function resolveDomain(
  service: KvService,
  rawDomain: unknown,
  write: boolean,
): string {
  if (typeof rawDomain !== 'string' || !rawDomain) {
    throw new Error('domain 必须是非空字符串');
  }
  const descriptor = service.domains().find((item) => item.name === rawDomain);
  if (!descriptor) throw new Error(`未知存储域：${rawDomain}`);
  if (descriptor.visibility !== 'readable') {
    throw new Error(`存储域 ${rawDomain} 不允许 Workflow 读取`);
  }
  if (write && descriptor.writableBy === 'host') {
    throw new Error(`存储域 ${rawDomain} 不允许 Workflow 写入`);
  }
  return rawDomain;
}

function requiredKey(args: Record<string, unknown>): string {
  if (typeof args['key'] !== 'string' || !args['key']) {
    throw new Error('key 必须是非空字符串');
  }
  return args['key'];
}

/** 仅注册到 Workflow 算子表；不会作为 kv_read / kv_write 等模型工具暴露。 */
export function createWorkflowStoragePrimitives(service: KvService): SkillPrimitive[] {
  return [
    storagePrimitive(
      'storage.get',
      '读取宿主本地存储。返回 {exists,value}，以区分键不存在与存储值为 null；拒绝读取 opaque 敏感域。',
      BASE_PROPERTIES,
      ['domain', 'key'],
      async (args) => {
        const domain = resolveDomain(service, args['domain'], false);
        return service.readRawEntry(domain, requiredKey(args));
      },
    ),
    storagePrimitive(
      'storage.set',
      '写入宿主本地存储。复用存储域既有写入权限、序列化与配额约束。',
      { ...BASE_PROPERTIES, value: {} },
      ['domain', 'key', 'value'],
      async (args) => {
        const domain = resolveDomain(service, args['domain'], true);
        const result = await service.put(domain, requiredKey(args), args['value']);
        if (!result.ok) throw new Error(result.reason ?? '存储写入失败');
        return { ok: true };
      },
    ),
    storagePrimitive(
      'storage.delete',
      '删除宿主本地存储中的指定键。拒绝删除 host-only 域。',
      BASE_PROPERTIES,
      ['domain', 'key'],
      async (args) => {
        const domain = resolveDomain(service, args['domain'], true);
        const key = requiredKey(args);
        await service.readRawEntry(domain, key); // 复用 KvService 的 key 合法性校验
        await service.remove(domain, key);
        return { ok: true };
      },
    ),
  ];
}
