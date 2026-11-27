/**
 * Host-native Workflow data operator coverage:
 * SkillPrimitive → OperatorRegistry → WorkflowRunner.
 * No plugin artifact, QuickJS runtime, Worker, or WASM is involved.
 */
import { describe, it, expect } from 'vitest';
import { createOperatorRegistry } from '../OperatorRegistry';
import { runWorkflow } from '../../skill/WorkflowRunner';
import { createWorkflowDataPrimitives } from '../../skill/primitives/WorkflowDataPrimitives';
import type { IPluginRuntime } from '../../../domain/plugin/types';
import type { PluginArtifactService } from '../PluginArtifactService';

async function createRegistry() {
  return createOperatorRegistry({
    primitives: createWorkflowDataPrimitives(),
    artifacts: { listActive: async () => [] } as unknown as PluginArtifactService,
    runtime: {
      run: async () => { throw new Error('此用例不应启动插件运行时'); },
      dispose: async () => undefined,
    } as unknown as IPluginRuntime,
  });
}

describe('Host-native Workflow data operators', () => {
  it('经 WorkflowRunner → OperatorRegistry 完成 regex match / extract / replace', async () => {
    const registry = await createRegistry();
    const result = await runWorkflow({
      steps: [
        {
          id: 'match',
          call: 'regex.match',
          args: { text: 'abc123', pattern: '(\\d+)' },
          yield: true,
        },
        {
          id: 'extract',
          call: 'regex.extract',
          args: { text: 'x12 y34', pattern: '\\d+', withIndex: true },
          yield: true,
        },
        {
          id: 'replace',
          call: 'regex.replace',
          args: { text: 'a1 b2', pattern: '\\d+', replacement: '#' },
          yield: true,
        },
      ],
    }, {}, registry);

    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      match: { matched: true, value: '123', index: 3, groups: ['123'] },
      extract: [
        { value: '12', index: 1 },
        { value: '34', index: 5 },
      ],
      replace: 'a# b#',
    });
  });

  it('JSON 算子直接消费原生值，并拒绝危险属性路径', async () => {
    const registry = await createRegistry();
    const result = await runWorkflow({
      steps: [
        {
          id: 'parse',
          call: 'json.parse',
          args: { text: '{"items":[{"uid":1},{"uid":2}]}' },
          yield: true,
        },
        {
          id: 'select',
          call: 'json.select',
          args: { where: { uid: { in: [2] } }, pick: ['uid'] },
          bindings: [{ from: 'parse', path: 'items', as: 'items' }],
          yield: true,
        },
      ],
    }, {}, registry);

    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      parse: { items: [{ uid: 1 }, { uid: 2 }] },
      select: [{ uid: 2 }],
    });

    const unsafe = await runWorkflow({
      steps: [
        { id: 'parse', call: 'json.parse', args: { text: '{"safe":true}' } },
        {
          id: 'unsafe',
          call: 'json.get',
          args: { path: '__proto__.polluted' },
          bindings: [{ from: 'parse', path: '$', as: 'value' }],
        },
      ],
    }, {}, registry);
    expect(unsafe.ok).toBe(false);
  });
});
