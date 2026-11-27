/**
 * Regex 算子端到端验收：
 * 已启用工件 → OperatorAdapter → OperatorRegistry → QuickJS WASM → 输出 Schema。
 *
 * fixture 是 weiqi-assets/plugins/workflow-operator/regex/index.js 的同步副本；
 * 修改资源插件源码时应同步此 fixture，避免测试只验证另一份实现。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QuickJsExecutor } from '../../../infrastructure/plugin-vm/QuickJsExecutor';
import { createOperatorRegistry } from '../OperatorRegistry';
import {
  WORKFLOW_OPERATOR_SPEC,
  WORKFLOW_OPERATOR_POINT_ID,
  type IPluginRuntime,
  type PluginArtifact,
  type OperatorArtifactContract,
} from '../../../domain/plugin/types';
import type { PluginArtifactService } from '../PluginArtifactService';

const wasmPath = resolve(
  process.cwd(),
  'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
);
function loadWasm(): ArrayBuffer {
  const buf = readFileSync(wasmPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const contract: OperatorArtifactContract = {
  exposes: [
    {
      name: 'match',
      description: '执行一次正则匹配。',
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        required: ['matched', 'value', 'index', 'groups'],
        properties: {
          matched: { type: 'boolean' },
          index: { type: 'integer' },
          groups: { type: 'array', items: { type: 'string' } },
        },
      },
      kind: 'pure',
      idempotent: true,
    },
    {
      name: 'extract',
      description: '全局提取正则匹配。',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'array' },
      kind: 'pure',
      idempotent: true,
    },
    {
      name: 'replace',
      description: '正则替换。',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'string' },
      kind: 'pure',
      idempotent: true,
    },
  ],
  smoke: [],
};

describe('Regex operator E2E', () => {
  it('经算子注册表在真实 QuickJS WASM 沙箱中完成 match / extract / replace', async () => {
    const code = readFileSync(
      resolve(process.cwd(), 'application/plugin/__tests__/fixtures/regex-plugin.js'),
      'utf8',
    );
    const executor = new QuickJsExecutor({ wasmBinary: loadWasm() });
    const runtime: IPluginRuntime = {
      run: (source, input, spec) => executor.execute({ code: source, input, spec }),
      dispose: async () => undefined,
    };
    const artifact: PluginArtifact = {
      id: 'regex-e2e',
      slug: 'regex',
      name: 'Regex E2E fixture',
      pointId: WORKFLOW_OPERATOR_POINT_ID,
      version: 1,
      enabled: true,
      origin: 'manual',
      intent: 'Regex operator E2E fixture',
      code,
      spec: WORKFLOW_OPERATOR_SPEC,
      operatorContract: contract,
      createdAt: 0,
      updatedAt: 0,
      history: [],
    };
    const artifacts = {
      listActive: async () => [artifact],
    } as unknown as PluginArtifactService;
    const registry = await createOperatorRegistry({ primitives: [], artifacts, runtime });

    const match = await registry.run('regex.match', {
      text: 'abc123',
      pattern: '(\\d+)',
    });
    expect(match.value).toEqual({
      matched: true,
      value: '123',
      index: 3,
      groups: ['123'],
    });

    const extract = await registry.run('regex.extract', {
      text: 'x12 y34',
      pattern: '\\d+',
      withIndex: true,
    });
    expect(extract.value).toEqual([
      { value: '12', index: 1 },
      { value: '34', index: 5 },
    ]);

    const replace = await registry.run('regex.replace', {
      text: 'a1 b2',
      pattern: '\\d+',
      replacement: '#',
    });
    expect(replace.value).toBe('a# b#');

    await runtime.dispose();
  });
});
